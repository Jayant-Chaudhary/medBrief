import { useEffect, useRef, useState } from 'react';
import { request } from '../../services/apiClient';

const pendingKeys = new Map();
const api = async (path, body) => {
  if (body === undefined) return request(`/api/community${path}`);
  const fingerprint = JSON.stringify([path, body]);
  if (!pendingKeys.has(fingerprint)) pendingKeys.set(fingerprint, crypto.randomUUID());
  const result = await request(`/api/community${path}`, {method:'POST',body:{requestKey:pendingKeys.get(fingerprint),...body}});
  pendingKeys.delete(fingerprint); return result;
};
const button = 'rounded-lg border border-line bg-surface hover:bg-subcanvas px-3 py-2 text-sm text-ink disabled:opacity-50 transition';
export default function CommunityWorkspace() {
  const [notice, setNotice] = useState(null), [member, setMember] = useState(null);
  const [queue, setQueue] = useState([]), [cases, setCases] = useState([]), [alerts, setAlerts] = useState([]), [reveals, setReveals] = useState([]);
  const [selected, setSelected] = useState(null), [messages, setMessages] = useState([]), [revisions, setRevisions] = useState([]);
  const [draft, setDraft] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [contact, setContact] = useState(null);
  const [reviewContext,setReviewContext]=useState(null), [singleReason,setSingleReason]=useState('');
  const expiry = useRef(null);
  async function run(task) { setBusy(true); setError(''); try { await task(); } catch { setError('The request could not be completed. Check your access or try again.'); } finally { setBusy(false); } }
  async function load() {
    const me = await api('/me'); setMember(me);
    if (!me.professional) return;
    const own = await api('/professional/cases'); setCases(own);
    // Assigned professionals may work their cases without being on the current roster.
    setQueue(await api('/professional/queue').catch(() => []));
    setAlerts(await api('/professional/alerts').catch(() => []));
    setReveals(await api('/professional/reveals').catch(() => []));
  }
  useEffect(() => { let live = true;
    (async () => { try { const n = await api('/notice'); if (!live) return; setNotice(n); if (n.enabled) await load(); } catch { if (live) setError('Community access is unavailable. If you have not joined, review the consent notice.'); } })();
    return () => { live = false; clearTimeout(expiry.current); pendingKeys.clear(); };
  }, []);
  useEffect(() => { if (!member?.professional) return undefined; const timer=setInterval(()=>{if(!document.hidden) load().catch(()=>setError('Queue refresh failed. Please retry.'));},15000); return ()=>clearInterval(timer); }, [member?.professional]);
  useEffect(() => { const clear = () => { if (document.hidden) setContact(null); }; document.addEventListener('visibilitychange', clear); return () => document.removeEventListener('visibilitychange', clear); }, []);
  async function open(item) { setSelected(item); setContact(null); setReason(''); setMessages(await api(`/care/threads/${item.threadId}/messages`)); setRevisions(await api(`/professional/cases/${item.id}/revisions`)); }
  async function decision(id, value) {
    if (!reason.trim()) { setError('Write a reason for this decision.'); return; }
    const reassessed = window.confirm('Confirm you reviewed the latest response status and assessed whether this decision is still necessary.');
    if (!reassessed) return;
    await request('/api/community/professional/reveals/decide', {method:'POST',body:{id,decision:value,reason,reassessed,singleApproverReason:singleReason || undefined}});
    await load(); setContact(null);
  }
  return <main className="min-h-screen bg-canvas p-6 text-ink"><div className="mx-auto max-w-6xl space-y-5">
    <header><h1 className="text-2xl font-semibold text-ink">Community care workspace</h1><p className="text-sm text-ink-soft">Private community review and outreach. Patient clinical records are separate.</p></header>
    {error && <p role="alert" className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 p-3 text-rose-800 dark:text-rose-300">{error}</p>}
    {!notice?.enabled && <p className="text-ink-3">Community support is not configured for launch yet.</p>}
    {notice?.enabled && !member && <section className="space-y-3 rounded-xl bg-surface border border-line p-5"><p className="text-ink">{notice.text}</p><button className={button} disabled={busy} onClick={() => run(async () => { await request('/api/community/enrol',{method:'POST',body:{noticeVersion:notice.version}}); await load(); })}>I understand and agree</button></section>}
    {member && !member.professional && <p className="text-ink-2">This workspace requires a verified community doctor or therapist role.</p>}
    {member?.moderator && <TagManager />}
    {member?.professional && <>
      <button className={button} disabled={busy} onClick={() => run(load)}>Refresh queue</button>
      {alerts.map(a => <p key={a.id} className="rounded bg-amber-100 dark:bg-amber-950/50 dark:text-amber-200 p-3 border border-amber-200 dark:border-amber-900/50">Operational review needed: {a.code}</p>)}
      <div className="grid gap-5 md:grid-cols-3"><aside className="space-y-4">
        <h2 className="font-semibold text-ink">Waiting for an on-call professional</h2>
        {queue.map(q => <div className="rounded-xl bg-surface border border-line p-3" key={q.id}><p className="text-ink font-medium">{q.tier} review</p><button className={`${button} mt-2`} disabled={busy} onClick={() => run(async () => { await api('/professional/claim',{id:q.id}); await load(); })}>Take this case</button></div>)}
        <h2 className="font-semibold text-ink">My open cases</h2>
        {cases.map(c => <button key={c.id} className={`${button} block w-full bg-surface text-left`} onClick={() => run(() => open(c))}>{c.username} · {c.tier}<br /><span className="text-xs text-ink-3">{c.status}</span></button>)}
        <h2 className="font-semibold text-ink">Reveal decisions</h2>
        <p className="text-xs text-ink-3">Use the written reason below. Identity remains hidden until approval.</p>
        {reveals.map(r => <div key={r.id} className="rounded-xl bg-surface border border-line p-3 space-y-2"><button className={button} disabled={busy} onClick={()=>run(async()=>setReviewContext(await request('/api/community/professional/reveals/context',{method:'POST',body:{id:r.id}})))}>Review request context</button><p className="text-body-sm text-ink-2">{r.tier}; {r.responded ? 'response received—reassess' : 'no response recorded'}</p><div className="flex gap-2"><button className={button} disabled={busy || !reason.trim()} onClick={() => run(() => decision(r.id,'approve'))}>Approve</button><button className={button} disabled={busy || !reason.trim()} onClick={() => run(() => decision(r.id,'deny'))}>Deny</button></div></div>)}
      </aside><section className="space-y-4 md:col-span-2">
        <label className="block text-ink-2">Written decision / outreach reason<textarea className="mt-1 block w-full rounded-lg border border-line bg-surface p-3 text-ink placeholder-ink-3" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="Describe the reason without identifying details." /></label>
        <label className="block text-ink-2">If using the clinic's single-approver policy, explain why a second approver is unavailable<textarea className="mt-1 block w-full rounded-lg border border-line bg-surface p-3 text-ink placeholder-ink-3" value={singleReason} onChange={e=>setSingleReason(e.target.value)} maxLength={2000} /></label>
        {reviewContext && <aside className="rounded-xl border border-line bg-surface p-4 space-y-1"><h2 className="font-semibold text-ink">Assigned reveal review</h2><p className="text-sm text-ink-3">{reviewContext.tier} · {reviewContext.respondedAt ? 'Response received; reassessment required' : 'No response recorded'}</p><p className="whitespace-pre-wrap text-ink">{reviewContext.content}</p>{reviewContext.assessment.map((reason,i)=><p key={i} className="text-body-sm text-ink-2">{reason}</p>)}</aside>}
        {selected ? <>
          <h2 className="text-xl font-semibold text-ink">{selected.username}</h2><p className="text-sm text-ink-3">Response: {selected.respondedAt ? 'Received; assessment remains open' : 'Not recorded'}</p>
          <button className={button} disabled={busy} onClick={() => run(() => open(selected))}>Refresh conversation</button>
          <div className="space-y-3">{messages.map(m => <article key={m.id} className="rounded-xl bg-surface border border-line p-4"><strong>{m.senderType === 'system' ? 'Care team' : m.username}</strong><p className="whitespace-pre-wrap text-ink mt-1">{m.body}</p></article>)}</div>
          {messages.length >= 50 && <button className={button} onClick={() => run(async()=>setMessages([...messages,...await api(`/care/threads/${selected.threadId}/messages?before=${messages.at(-1).id}`)]))}>More messages</button>}
          <textarea className="w-full rounded-lg border border-line bg-surface p-3 text-ink placeholder-ink-3" value={draft} maxLength={10000} onChange={e=>setDraft(e.target.value)} placeholder="Write a private message" />
          <button className={button} disabled={busy || !draft.trim()} onClick={() => run(async () => { await api('/care/messages',{id:selected.threadId,body:draft}); setDraft(''); await open(selected); })}>Send private message</button>
          <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !reason.trim()} onClick={() => run(async () => { await api('/professional/assess_case',{id:selected.id,eligible:true,reason}); await load(); })}>Record assessment: reveal review may be needed</button><button className={button} disabled={busy || !reason.trim()} onClick={() => run(async () => { await api('/professional/assess_case',{id:selected.id,eligible:false,reason}); await load(); })}>Keep identity protected</button><button className={button} disabled={busy || !reason.trim()} onClick={() => run(async () => { await api('/professional/close_case',{id:selected.id,reason}); setSelected(null); setContact(null); await load(); })}>Close case with reason</button></div>
          {selected.revealRequestId && <button className={button} disabled={busy} onClick={() => run(async () => { const data=await request('/api/community/professional/reveals/contact',{method:'POST',body:{id:selected.revealRequestId}}); setContact(data); clearTimeout(expiry.current); expiry.current=setTimeout(()=>setContact(null),Math.max(0,new Date(data.expiresAt).getTime()-Date.now())); })}>View approved contact details</button>}
          {contact && <aside className="rounded-lg border border-amber-500 bg-surface p-4"><strong>Temporary access</strong><p>{contact.name}</p><p>{contact.phone}</p><button className={button} onClick={()=>setContact(null)}>Hide details</button></aside>}
          {revisions.map(r=><article key={r.id} className="rounded-xl bg-surface border border-line p-4 space-y-1"><h3 className="font-semibold text-ink">{r.title}</h3><p className="whitespace-pre-wrap text-ink">{r.body}</p><p className="text-xs text-ink-3">{r.state} · {r.tier}</p>{r.state==='held' && <div className="flex gap-2 mt-2">{[true,false].map(publish=><button key={String(publish)} className={button} disabled={busy || !reason.trim()} onClick={()=>run(async()=>{await api('/professional/review_revision',{id:selected.id,revisionId:r.id,publish,reason});await open(selected);})}>{publish?'Approve publication':'Keep unpublished'}</button>)}</div>}</article>)}
        </> : <p className="text-ink-3">Select an assigned case to view its private conversation.</p>}
      </section></div>
    </>}
  </div></main>;
}

function TagManager() {
  const [tags,setTags]=useState([]),[name,setName]=useState(''),[slug,setSlug]=useState(''),[error,setError]=useState('');
  const refresh=()=>api('/moderator/tags').then(setTags).catch(()=>setError('Tag access unavailable.'));
  useEffect(()=>{refresh();},[]);
  async function save(tag){try{await request('/api/community/moderator/tags',{method:'POST',body:tag});setName('');setSlug('');await refresh();}catch{setError('Could not save the tag.');}}
  return <section className="space-y-3 rounded-xl bg-surface border border-line p-5"><h2 className="font-semibold text-ink">Manage community tags</h2>{error&&<p role="alert" className="text-rose-500 text-sm">{error}</p>}<input className="rounded-lg border border-line bg-surface p-2 text-ink text-sm" aria-label="Tag name" placeholder="Tag name" value={name} onChange={e=>setName(e.target.value)} maxLength={80}/><input className="rounded-lg border border-line bg-surface p-2 text-ink text-sm" aria-label="Tag slug" placeholder="short-tag-name" value={slug} onChange={e=>setSlug(e.target.value)} maxLength={60}/><button className={button} disabled={!name.trim()||!/^[a-z0-9-]+$/.test(slug)} onClick={()=>save({name,slug,active:true})}>Save tag</button>{tags.map(t=><div key={t.id} className="flex gap-3 items-center"><span className="text-ink text-sm">{t.name}</span><button className={button} onClick={()=>save({name:t.name,slug:t.slug,active:!t.active})}>{t.active?'Deactivate':'Activate'}</button></div>)}</section>;
}
