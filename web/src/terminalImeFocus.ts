/**
 * Keep desktop terminal focus on the editable textarea after Ghostty's
 * selection manager moves it back to the non-editable terminal host.
 */
export function installTerminalImeFocusRedirect(options: {
  container: HTMLElement;
  textarea: HTMLTextAreaElement;
  hasAlternateTapFocus: () => boolean;
  focusTextarea: () => void;
}) {
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Node) || !options.container.contains(target)) {
      return;
    }
    if (target === options.textarea || options.hasAlternateTapFocus()) {
      return;
    }
    options.focusTextarea();
  };

  options.container.addEventListener("focusin", onFocusIn);
  return () => options.container.removeEventListener("focusin", onFocusIn);
}
