/**
 * The MedBrief mark in gold and silver for the assistant button: the logo in
 * greyscale (silver), tinted gold through its own shape, with a passing shine
 * and a few twinkling sparkles. Motion is turned off for users who ask for
 * reduced motion. Decorative only: the button around it carries the label.
 */
const SPARKS = [0, 1, 2, 3, 4];

export default function AssistantMark({ size = 30, sparkle = true }) {
  return (
    <span className="assistant-mark" style={{ width: size, height: size }} aria-hidden="true">
      <img src="/logo-mark.png" alt="" draggable="false" className="assistant-mark__silver" />
      <span className="assistant-mark__gold" />
      <span className="assistant-mark__shine" />
      {sparkle && SPARKS.map((i) => <span key={i} className={`assistant-mark__spark assistant-mark__spark--${i}`} />)}
    </span>
  );
}
