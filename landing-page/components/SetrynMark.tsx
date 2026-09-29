import type { SVGProps } from "react";

/**
 * Setryn's mark: hatom's egg crossed by TACEO's diagonal, with zk.email's
 * orbit dot. Strokes use pathLength=1 so the loader can draw them in.
 */
export default function SetrynMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 56" fill="none" aria-hidden="true" {...props}>
      <path
        data-mark="egg"
        pathLength={1}
        d="M24 3C36 3 44 21 44 33C44 45 35 53 24 53C13 53 4 45 4 33C4 21 12 3 24 3Z"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path data-mark="slash" pathLength={1} d="M12 45L37 13" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
      <circle data-mark="dot" cx="31" cy="37" r="3.2" fill="currentColor" />
    </svg>
  );
}
