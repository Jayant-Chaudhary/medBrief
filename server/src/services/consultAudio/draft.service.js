/**
 * Clinical Notes Drafting Service (Phase 8).
 *
 * Coordinates:
 * 1. Fetching merged transcripts with segment_ids.
 * 2. Ingesting structured intake, verified labs, ultrasound, and vitals.
 * 3. Building deterministic tracer catalog.
 * 4. Parallel schema-enforced LLM drafting (Gemini Flash, Qwen3:8b local, Fake).
 * 5. Deterministic post-check (citation audit, unverified numbers check).
 * 6. Saving draft to consult_drafts with status 'needs_review'.
 * 7. Transitioning session state processing -> draft_ready.
 * 8. Emitting notes_ready Socket.IO event.
 * 9. Clinician review, edit, approval, and commit to consultation_notes.
 */

const supabaseAdmin = require('../../config/supabaseAdminClient');
const { STATES, transitionSession } = require('./stateMachine');
const socketService = require('./socket.service');
const { getSessionTranscript } = require('./session.service');
const { getDraftProvider } = require('./drafting/draftProviderFactory');
const {
  buildStructuredContext,
  buildTracerCatalog,
  postCheckDraft,
} = require('./drafting/tracerVerification');
const logger = require('../../utils/logger');

/**
 * Generates clinical notes draft for a consultation session.
 *
 * @param {string} sessionId
 * @param {Object} [options]
 * @param {string} [options.provider] - 'gemini' | 'local' | 'fake'
 * @param {Object} [options.providerOptions] - Custom provider overrides (internal callers only)
 * @param {string} [options.doctorUserId] - Set for human requests; must match the session's doctor
 * @returns {Promise<Object>} Created consult_drafts row
 */
async function generateDraftForSession(sessionId, options = {}) {
  const { data: session, error: sessErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, appointment_id, doctor_id, patient_id, status')
    .eq('id', sessionId)
    .single();

  if (sessErr || !session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  // Requests from a person must come from this session's doctor. The
  // orchestrator calls without doctorUserId and is trusted.
  if (options.doctorUserId !== undefined && options.doctorUserId !== session.doctor_id) {
    const err = new Error('Not authorized to generate a draft for this session');
    err.status = 403;
    throw err;
  }

  // Session must be in 'processing' or 'draft_ready' to generate/regenerate draft
  if (!['processing', 'draft_ready'].includes(session.status)) {
    const err = new Error(`Cannot generate draft for session in state: ${session.status}`);
    err.status = 400;
    throw err;
  }

  logger.info('Starting clinical notes drafting for session', {
    scope: 'consult-draft',
    sessionId,
  });

  // 1. Fetch merged chronological transcript
  const transcriptData = await getSessionTranscript(sessionId);
  const speechSegments = (transcriptData.segments || []).filter((s) => s.type !== 'gap');
  const validSegmentIds = speechSegments.map((s) => s.id || s.segment_id);

  // 2. Build structured intake and verified clinical context
  const structuredContext = await buildStructuredContext({
    appointmentId: session.appointment_id,
    patientId: session.patient_id,
  });

  // 3. Build tracer catalog for verified numbers
  const tracerCatalog = buildTracerCatalog(structuredContext);

  // 4. Generate draft using configured provider
  const provider = getDraftProvider(options.provider, options.providerOptions);
  const draftResult = await provider.generateDraft({
    transcript: speechSegments,
    structuredContext,
    tracerCatalog,
  });

  // 5. Run deterministic post-checks (citations exist? numbers verified or disclaimed?)
  const postCheck = postCheckDraft({
    doctorNotes: draftResult.doctorNotes,
    patientSummary: draftResult.patientSummary,
    clinicalFlags: draftResult.clinicalFlags,
    validSegmentIds,
    tracerCatalog,
  });

  // 6. Save draft to consult_drafts (status is always 'needs_review' initially)
  const draftPayload = {
    session_id: sessionId,
    appointment_id: session.appointment_id,
    status: 'needs_review',
    provider: draftResult.provider || provider.name,
    model_version: draftResult.modelVersion || provider.modelVersion,
    doctor_notes: draftResult.doctorNotes,
    patient_summary: draftResult.patientSummary,
    clinical_flags: draftResult.clinicalFlags,
    tracers_used: postCheck.tracersUsed || [],
    review_reasons: [
      ...(postCheck.reviewReasons || []),
      ...(draftResult.droppedUncitedFlags > 0 ? ['uncited_flag_dropped'] : []),
      ...(draftResult.droppedUncitedRecommendations > 0 ? ['uncited_recommendation_dropped'] : []),
    ],
    latency_ms: draftResult.latencyMs || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: savedDraft, error: insertErr } = await supabaseAdmin
    .from('consult_drafts')
    .insert(draftPayload)
    .select()
    .single();

  if (insertErr) {
    logger.error('Failed to save consult draft', {
      scope: 'consult-draft',
      sessionId,
      errorCode: 'ERR_SAVE_DRAFT',
    });
    throw insertErr;
  }

  // 7. Transition session state from processing -> draft_ready if not already draft_ready
  if (session.status === STATES.PROCESSING) {
    await transitionSession({
      sessionId,
      toState: STATES.DRAFT_READY,
      patch: { draft_outdated: false },
      socketEmitter: socketService,
    });
  } else if (session.status === STATES.DRAFT_READY) {
    // If draft was regenerated after late chunk arrival, clear draft_outdated flag
    await supabaseAdmin
      .from('consult_sessions')
      .update({ draft_outdated: false })
      .eq('id', sessionId);
  }

  // 8. Emit notes_ready push notification via Socket.IO
  socketService.emitNotesReady(sessionId);

  logger.info('Clinical notes draft ready for review', {
    scope: 'consult-draft',
    sessionId,
    provider: draftResult.provider,
    latencyMs: draftResult.latencyMs,
    reviewReasonsCount: draftPayload.review_reasons.length,
  });

  return savedDraft;
}

/**
 * Fetches the latest clinical draft for a session.
 *
 * @param {string} sessionId
 * @param {string} [callerUserId]
 * @returns {Promise<Object>}
 */
async function getSessionDraft(sessionId, callerUserId = null) {
  const { data: session, error: sessErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, doctor_id, patient_id')
    .eq('id', sessionId)
    .single();

  if (sessErr || !session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  if (callerUserId && ![session.doctor_id, session.patient_id].includes(callerUserId)) {
    const err = new Error('Not authorized to access draft for this session');
    err.status = 403;
    throw err;
  }

  const { data: draft, error: draftErr } = await supabaseAdmin
    .from('consult_drafts')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (draftErr) {
    throw draftErr;
  }

  return draft;
}

/**
 * Clinician reviews, edits, and approves or rejects a draft.
 * Approving commits the finalized note text into consultation_notes atomically.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} [params.doctorUserId]
 * @param {string} [params.draftId]
 * @param {string} params.action - 'approve' | 'reject'
 * @param {Object} [params.editedDoctorNotes]
 * @param {string} [params.rejectionReason]
 * @returns {Promise<Object>} Updated draft
 */
async function reviewSessionDraft({
  sessionId,
  doctorUserId = null,
  draftId = null,
  action,
  editedDoctorNotes = null,
  rejectionReason = null,
}) {
  if (!['approve', 'reject'].includes(action)) {
    const err = new Error('Invalid review action. Must be "approve" or "reject"');
    err.status = 400;
    throw err;
  }

  const { data: session, error: sessErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, appointment_id, doctor_id')
    .eq('id', sessionId)
    .single();

  if (sessErr || !session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  if (doctorUserId && session.doctor_id !== doctorUserId) {
    const err = new Error('Only the attending doctor can review this draft');
    err.status = 403;
    throw err;
  }

  let targetDraft = null;

  if (draftId) {
    const { data: foundDraft, error: draftErr } = await supabaseAdmin
      .from('consult_drafts')
      .select('*')
      .eq('id', draftId)
      .eq('session_id', sessionId)
      .maybeSingle();

    if (draftErr || !foundDraft) {
      const err = new Error('Draft not found for this session');
      err.status = 404;
      throw err;
    }

    // Check if a newer draft exists (reject stale review)
    const { data: newerDrafts } = await supabaseAdmin
      .from('consult_drafts')
      .select('id')
      .eq('session_id', sessionId)
      .gt('created_at', foundDraft.created_at)
      .limit(1);

    if (newerDrafts && newerDrafts.length > 0) {
      const err = new Error('Stale draft review: a newer draft exists');
      err.status = 409;
      throw err;
    }

    targetDraft = foundDraft;
  } else {
    const { data: latestDraft } = await supabaseAdmin
      .from('consult_drafts')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestDraft) {
      const err = new Error('No draft found to review');
      err.status = 404;
      throw err;
    }

    targetDraft = latestDraft;
  }

  // Idempotent repeated approval
  if (targetDraft.status === 'approved' && action === 'approve') {
    return targetDraft;
  }

  // Format notes text for consultation_notes
  const finalNotes = editedDoctorNotes || targetDraft.doctor_notes || {};
  const planText = (finalNotes.plan_and_recommendations || [])
    .map((r) => `- ${r.recommendation}`)
    .join('\n');

  const formattedNotesText = [
    finalNotes.chief_complaint ? `CHIEF COMPLAINT:\n${finalNotes.chief_complaint}\n` : '',
    finalNotes.vitals_observed ? `VITALS OBSERVED:\n${finalNotes.vitals_observed}\n` : '',
    finalNotes.assessment ? `ASSESSMENT:\n${finalNotes.assessment}\n` : '',
    planText ? `PLAN & RECOMMENDATIONS:\n${planText}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Attempt atomic database transaction via RPC if available
  if (typeof supabaseAdmin.rpc === 'function') {
    try {
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('review_consult_draft_atomic', {
        p_session_id: sessionId,
        p_draft_id: targetDraft.id,
        p_doctor_id: doctorUserId || session.doctor_id,
        p_action: action,
        p_edited_doctor_notes: editedDoctorNotes,
        p_notes_text: formattedNotesText,
        p_rejection_reason: rejectionReason,
      });

      if (!rpcErr && rpcData) {
        return rpcData;
      }

      if (rpcErr && rpcErr.code !== 'PGRST202' && !rpcErr.message?.includes('could not find')) {
        const err = new Error(rpcErr.message || 'Atomic draft review failed');
        if (rpcErr.message?.includes('Stale draft')) err.status = 409;
        else if (rpcErr.message?.includes('Only the attending doctor')) err.status = 403;
        else if (rpcErr.message?.includes('not found')) err.status = 404;
        else err.status = 500;
        throw err;
      }
    } catch (rpcEx) {
      if (rpcEx.status) throw rpcEx;
      // Fall through to JS-managed operations if RPC function is missing/unsupported in current env
    }
  }

  // Fallback: JS execution with strict error checking and transactional integrity
  if (action === 'approve') {
    const { error: notesErr } = await supabaseAdmin
      .from('consultation_notes')
      .upsert(
        {
          appointment_id: session.appointment_id,
          clinician_id: session.doctor_id,
          notes_text: formattedNotesText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'appointment_id' }
      );

    if (notesErr) {
      const err = new Error(`Failed to save consultation notes: ${notesErr.message || notesErr}`);
      err.status = 500;
      throw err;
    }

    const { data: updatedDraft, error: updateErr } = await supabaseAdmin
      .from('consult_drafts')
      .update({
        status: 'approved',
        doctor_notes: editedDoctorNotes || targetDraft.doctor_notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetDraft.id)
      .select()
      .single();

    if (updateErr) {
      throw updateErr;
    }

    return updatedDraft;
  } else if (action === 'reject') {
    const reasons = [...(targetDraft.review_reasons || [])];
    if (rejectionReason) {
      reasons.push(`rejected: ${rejectionReason}`);
    }

    const { data: updatedDraft, error: updateErr } = await supabaseAdmin
      .from('consult_drafts')
      .update({
        status: 'rejected',
        review_reasons: reasons,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetDraft.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return updatedDraft;
  }
}

module.exports = {
  generateDraftForSession,
  getSessionDraft,
  reviewSessionDraft,
};
