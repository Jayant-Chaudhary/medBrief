import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import 'consult_audio_controller.dart';

class ConsultAudioPage extends StatefulWidget {
  const ConsultAudioPage({
    super.key,
    required this.controller,
    this.onFinished,
  });

  final ConsultAudioController controller;
  final VoidCallback? onFinished;

  @override
  State<ConsultAudioPage> createState() => _ConsultAudioPageState();
}

class _ConsultAudioPageState extends State<ConsultAudioPage> {
  final _codeController = TextEditingController();

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final stage = widget.controller.stage;

        return Scaffold(
          backgroundColor: canvas,
          appBar: AppBar(
            backgroundColor: canvas,
            elevation: 0,
            leading: const BackButton(color: ink),
            title: const Text(
              'Consultation Visit',
              style: TextStyle(
                color: ink,
                fontWeight: FontWeight.w700,
                fontSize: 18,
              ),
            ),
          ),
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: _buildStage(stage)),
                  if (widget.controller.canLeaveRoom) ...[
                    const SizedBox(height: 8),
                    TextButton.icon(
                      key: const Key('leave-room'),
                      onPressed: widget.controller.leaving ? null : _confirmLeave,
                      icon: const Icon(Icons.logout),
                      label: const Text('Leave this room'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _confirmLeave() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Leave this room?'),
        content: const Text(
          'Your phone will stop waiting for this visit. To join again, ask your doctor for the new code.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Stay'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Leave'),
          ),
        ],
      ),
    );
    if (confirmed == true) await widget.controller.leaveRoom();
  }

  Widget _buildStage(PatientConsultStage stage) {
    return switch (stage) {
                PatientConsultStage.entry => _buildEntryView(),
                PatientConsultStage.joining => _buildLoadingView(
                  'Connecting to consultation room...',
                ),
                PatientConsultStage.consent => _buildConsentView(),
                PatientConsultStage.permissions => _buildPermissionsView(),
                PatientConsultStage.levelCheck => _buildLevelCheckView(),
                PatientConsultStage.syncing => _buildLoadingView(
                  'Synchronizing visit clock...',
                ),
                PatientConsultStage.readyWait => _buildReadyWaitView(),
                PatientConsultStage.recording => _buildRecordingView(),
                PatientConsultStage.ending => _buildLoadingView(
                  'Uploading final audio...',
                ),
                PatientConsultStage.pending => _buildPendingView(),
                PatientConsultStage.completed => _buildCompletedView(),
                PatientConsultStage.error => _buildErrorView(),
              };
  }

  Widget _buildEntryView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 20),
        const Icon(Icons.meeting_room_outlined, size: 56, color: primary),
        const SizedBox(height: 16),
        const Text(
          'Join Consultation',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w800,
            color: ink,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Enter the 6-character room code provided by your doctor.',
          textAlign: TextAlign.center,
          style: TextStyle(color: muted, fontSize: 14),
        ),
        const SizedBox(height: 32),
        TextField(
          controller: _codeController,
          autofocus: true,
          maxLength: 6,
          textAlign: TextAlign.center,
          textCapitalization: TextCapitalization.characters,
          style: const TextStyle(
            fontSize: 32,
            fontWeight: FontWeight.w800,
            letterSpacing: 8,
            color: ink,
          ),
          decoration: const InputDecoration(
            counterText: '',
            hintText: 'ABCDEF',
          ),
        ),
        if (widget.controller.errorMessage != null) ...[
          const SizedBox(height: 12),
          Text(
            widget.controller.errorMessage!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFF9E543B), fontSize: 13),
          ),
        ],
        const Spacer(),
        FilledButton(
          onPressed: () =>
              widget.controller.submitRoomCode(_codeController.text),
          child: const Text('Join Room'),
        ),
      ],
    );
  }

  Widget _buildConsentView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 16),
        const Icon(Icons.verified_user_outlined, size: 56, color: primary),
        const SizedBox(height: 16),
        const Text(
          'Consultation Recording Consent',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: ink,
          ),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: line),
          ),
          child: Text(
            'Your visit audio will be recorded to help your care team prepare draft notes for review. Your clinic\'s configured transcription service processes the audio.\n\n'
            'Pending audio stays in this app\'s private storage until the clinic server confirms receipt. '
            'Unsent audio is removed after ${widget.controller.config.storageRetentionHours} hours when the app is running, or when it next opens.',
            style: const TextStyle(fontSize: 14, color: ink, height: 1.5),
          ),
        ),
        const Spacer(),
        FilledButton(
          onPressed: widget.controller.acceptConsent,
          child: const Text('I Agree & Continue'),
        ),
      ],
    );
  }

  Widget _buildPermissionsView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 20),
        const Icon(Icons.mic_outlined, size: 56, color: primary),
        const SizedBox(height: 16),
        const Text(
          'Permissions Required',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: ink,
          ),
        ),
        const SizedBox(height: 12),
        const Text(
          'To record the visit and show a persistent recording indicator while your screen is locked, MedBrief requires microphone and notification permissions.',
          textAlign: TextAlign.center,
          style: TextStyle(color: muted, fontSize: 14, height: 1.4),
        ),
        if (widget.controller.errorMessage != null) ...[
          const SizedBox(height: 16),
          Text(
            widget.controller.errorMessage!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFF9E543B), fontSize: 13),
          ),
        ],
        const Spacer(),
        FilledButton(
          onPressed: widget.controller.requestPermissions,
          child: const Text('Grant Permissions'),
        ),
      ],
    );
  }

  Widget _buildLevelCheckView() {
    final normLevel = ((widget.controller.micLevelDbfs + 60) / 60).clamp(
      0.0,
      1.0,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 20),
        const Icon(Icons.graphic_eq, size: 56, color: primary),
        const SizedBox(height: 16),
        const Text(
          'Check Microphone',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: ink,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Speak a few words to confirm your microphone is responding clearly.',
          textAlign: TextAlign.center,
          style: TextStyle(color: muted, fontSize: 14),
        ),
        const SizedBox(height: 36),
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: LinearProgressIndicator(
            value: normLevel,
            minHeight: 24,
            backgroundColor: line,
            color: primary,
          ),
        ),
        const Spacer(),
        FilledButton(
          onPressed: widget.controller.micCheckReady
              ? widget.controller.confirmMicAndSyncClock
              : null,
          child: const Text('Everything Sounds Good — Continue'),
        ),
      ],
    );
  }

  Widget _buildReadyWaitView() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.check_circle_outline, size: 64, color: primary),
        const SizedBox(height: 20),
        const Text(
          'You are Ready',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w800,
            color: ink,
          ),
        ),
        const SizedBox(height: 12),
        const Text(
          'Waiting for your doctor to start the visit.\nRecording will begin automatically.',
          textAlign: TextAlign.center,
          style: TextStyle(color: muted, fontSize: 15, height: 1.4),
        ),
        const SizedBox(height: 32),
        const Center(child: CircularProgressIndicator(color: primary)),
      ],
    );
  }

  Widget _buildRecordingView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: const Color(0xFFFEE2E2),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFFCA5A5)),
          ),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.fiber_manual_record,
                color: Color(0xFFDC2626),
                size: 20,
              ),
              SizedBox(width: 8),
              Text(
                'Active Consultation Recording',
                style: TextStyle(
                  color: Color(0xFF991B1B),
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Background Recording Active',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 16,
                  color: ink,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Recording stays active when the screen is locked. Keep the recording notification visible and return here if an interruption occurs.',
                style: TextStyle(fontSize: 13, color: muted, height: 1.4),
              ),
              const Divider(height: 32, color: line),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Chunks uploaded:',
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                  Text(
                    '${widget.controller.uploadedChunksCount}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const Spacer(),
        OutlinedButton(
          onPressed: widget.controller.endConsultation,
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(double.infinity, 52),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
          ),
          child: const Text('Leave Visit'),
        ),
      ],
    );
  }

  Widget _buildLoadingView(String message) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(color: primary),
          const SizedBox(height: 24),
          Text(message, style: const TextStyle(color: muted, fontSize: 15)),
        ],
      ),
    );
  }

  Widget _buildCompletedView() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.task_alt, size: 64, color: primary),
        const SizedBox(height: 20),
        const Text(
          'Visit Finished',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w800,
            color: ink,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          widget.controller.incomplete
              ? 'Files were sent with missing audio flagged for your doctor.'
              : 'Your consultation audio was uploaded successfully. Your doctor will review the notes.',
          textAlign: TextAlign.center,
          style: TextStyle(color: muted, fontSize: 15, height: 1.4),
        ),
        const SizedBox(height: 36),
        FilledButton(
          onPressed: () {
            widget.onFinished?.call();
            Navigator.of(context).pop();
          },
          child: const Text('Done'),
        ),
      ],
    );
  }

  Widget _buildErrorView() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.error_outline, size: 64, color: Color(0xFF9E543B)),
        const SizedBox(height: 20),
        const Text(
          'Something went wrong',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: ink,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          widget.controller.errorMessage ??
              'An error occurred during consultation recording.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: muted, fontSize: 14),
        ),
        const SizedBox(height: 36),
        FilledButton(
          onPressed: widget.controller.retry,
          child: const Text('Try Again'),
        ),
      ],
    );
  }

  Widget _buildPendingView() => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.cloud_upload_outlined, size: 48, color: primary),
        const SizedBox(height: 16),
        const Text(
          'Files pending',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 12),
        Text(
          widget.controller.errorMessage ??
              'Sending files in the background. Open this screen after reconnecting to check progress.',
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: widget.controller.retry,
          child: const Text('Resume uploads'),
        ),
        TextButton(
          onPressed: () async {
            final confirmed = await showDialog<bool>(
              context: context,
              builder: (dialogContext) => AlertDialog(
                title: const Text('Delete unsent audio?'),
                content: const Text(
                  'Pending audio on this phone will be deleted. Missing audio will be flagged for the clinic.',
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(dialogContext, false),
                    child: const Text('Keep files'),
                  ),
                  TextButton(
                    onPressed: () => Navigator.pop(dialogContext, true),
                    child: const Text('Delete unsent audio'),
                  ),
                ],
              ),
            );
            if (confirmed == true) await widget.controller.discardPending();
          },
          child: const Text('Delete unsent audio'),
        ),
      ],
    ),
  );
}
