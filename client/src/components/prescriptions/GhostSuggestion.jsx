import { X, ChevronRight } from 'lucide-react';
export function GhostSuggestion({ suggestion, hasEmptyRow, onAccept, onDismiss, onReview }) {
  if (!suggestion) return null;
  const item = suggestion.medication;
  return <div className="rx-ghost" aria-label="Unaccepted prescription suggestion">
    <div className="rx-ghost-heading"><span>BEST RECORDED MATCH · {suggestion.match.score}% supported similarity</span><button type="button" className="rx-icon" aria-label="Dismiss ghost suggestion" onClick={onDismiss}><X size={14}/></button></div>
    <div className="rx-ghost-line"><strong>{item.name}</strong><span>{[item.strength,item.dose,item.route,item.frequency,item.duration].filter(Boolean).join(' · ') || 'Saved item details need review'}</span></div>
    <div className="rx-ghost-footer"><button type="button" className="rx-text" onClick={onReview}>Review source <ChevronRight size={12}/></button><button type="button" className="rx-button" onClick={onAccept}>Add saved item</button></div>
    <p>{hasEmptyRow ? 'Tab in the empty medicine name accepts this saved item; Esc dismisses it.' : 'Suggested text only. Choose Add saved item to put it in the draft.'} Values are copied from the source prescription.</p>
  </div>;
}
