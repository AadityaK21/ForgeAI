/** A cutaway of a generated app. All three plates share one projection. */
export function AssemblyDrawing() {
  return (
    <figure className="fx-assembly" aria-label="Exploded drawing of an app's interface, API and data layers">
      <div className="fx-plate-caption"><span>FIG. 01</span><span>APPLICATION STUDY</span></div>
      <svg viewBox="0 0 390 208" fill="none" aria-hidden="true">
        <defs>
          <pattern id="forge-grid" width="15" height="15" patternUnits="userSpaceOnUse"><path d="M0 0h1v1H0z" fill="currentColor"/></pattern>
          <pattern id="forge-hatch" width="5" height="5" patternUnits="userSpaceOnUse"><path d="m-1 1 2-2m-1 6 5-5m-1 6 2-2" stroke="currentColor" strokeWidth=".7"/></pattern>
        </defs>
        <rect width="390" height="208" fill="url(#forge-grid)" opacity=".32"/>
        <g stroke="currentColor" strokeWidth=".8" opacity=".45" strokeDasharray="2 4">
          <path d="M62 86v77m101-125v77m111-28v78m-101-28v66"/>
        </g>
        <g className="fx-plate fx-plate--base" stroke="currentColor" strokeLinejoin="round">
          <path d="m62 157 101-49 111 50-101 49Z" className="fx-plate-base"/>
          <path d="m62 152 101-49 111 50-101 49Z" className="fx-plate-paper"/>
          <path d="m73 152 90-43 99 44-89 43Z" fill="url(#forge-hatch)"/>
        </g>
        <g className="fx-plate fx-plate--middle" stroke="currentColor" strokeLinejoin="round">
          <path d="m62 120 101-49 111 50-101 49Z" className="fx-plate-base"/>
          <path d="m62 116 101-49 111 50-101 49Z" className="fx-plate-paper"/>
          <g opacity=".7"><path d="m96 116 19-9 21 9-19 9zm36-17 19-9 21 9-19 9zm17 42 19-9 21 9-19 9zm37-18 19-9 21 9-19 9z"/><path d="m126 120 26 12 38-18-27-12"/></g>
        </g>
        <g className="fx-plate fx-plate--top" stroke="currentColor" strokeLinejoin="round">
          <path d="m62 86 101-49 111 50-101 49Z" className="fx-plate-base"/>
          <path d="m62 81 101-49 111 50-101 49Z" className="fx-plate-paper"/>
          <path d="m75 81 88-43 13 6-89 43Z" fill="currentColor"/>
          <path d="m95 89 38-18 23 10-38 18Z" fill="url(#forge-hatch)"/>
          <path d="m143 68 35-17m-28 20 24-12m-17 15 31-15m-61 43 72-34m-65 38 61-29" opacity=".8"/>
        </g>
        <g className="fx-plate-labels" stroke="currentColor" strokeWidth=".8">
          <path d="m251 70 21-12h20m-39 57 21-11h18m-40 46 22-11h18"/>
        </g>
        <g className="fx-plate-words" fill="currentColor" fontSize="9" letterSpacing="1"><text x="300" y="61">01 / UI</text><text x="300" y="107">02 / API</text><text x="300" y="142">03 / DATA</text></g>
      </svg>
    </figure>
  );
}
