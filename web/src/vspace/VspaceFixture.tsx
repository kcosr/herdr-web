/**
 * Test fixture for the visual-space Playwright harness.
 *
 * URL params (all optional, default shown):
 *   ?compact=1      compactControls=true  (default: true — keys row hidden)
 *   ?compact=0      compactControls=false (keys row visible)
 *   ?expanding=1    expandingInput=true   (default: true)
 *   ?expanding=0    expandingInput=false  (plain single-line input)
 */
import { createRef, useState } from "react";
import { MobileTerminalControls } from "../TerminalView";
import "../styles.css";

function parseFlag(param: string | null, defaultVal: boolean): boolean {
  if (param === null) return defaultVal;
  return param !== "0";
}

export function VspaceFixture() {
  const params = new URLSearchParams(window.location.search);
  const [compact, setCompact] = useState(() => parseFlag(params.get("compact"), true));
  const [expandingInput] = useState(() => parseFlag(params.get("expanding"), true));

  const commandInputRef = createRef<HTMLInputElement | HTMLTextAreaElement>();
  const noop = () => {};

  return (
    <div
      className="vspace-fixture"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100dvh",
        overflow: "hidden",
        // Apply the mobile controls scale variable at root level
        "--mobile-controls-scale": "1",
      } as React.CSSProperties}
    >
      {/* Fake terminal area — takes all remaining space */}
      <div
        data-testid="terminal-area"
        style={{
          flex: "1 1 0",
          minHeight: 0,
          background: "#11111b",
          overflow: "hidden",
        }}
      />
      {/* Mobile input panel under test */}
      <MobileTerminalControls
        commandInputRef={commandInputRef}
        disabled={false}
        uploadDisabled={false}
        expandingInput={expandingInput}
        enterNewline={false}
        controlsScalePercent={100}
        compactControls={compact}
        onCompactControlsChange={setCompact}
        mobileModeActive={false}
        onToggleMobileMode={noop}
        onControlsHeightChange={noop}
        onInput={noop}
        onTerminalFocus={noop}
        onUpload={noop}
        onStageCommand={noop}
        onSubmitCommand={noop}
        onNextAgentPane={noop}
        onPrevAgentPane={noop}
        pinned={false}
        onPaneCycle={noop}
        onPaneCycleModeToggle={noop}
        paneCycleMode="pin"
      />
    </div>
  );
}
