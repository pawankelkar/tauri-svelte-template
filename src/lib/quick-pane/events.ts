/**
 * The cross-window event contract between the Quick Pane and the main window.
 *
 * Both ends import from here so a rename can never leave one side listening
 * for a string the other no longer emits.
 */
export const QUICK_PANE_SUBMIT_EVENT = 'quick-pane-submit'

export interface QuickPaneSubmitPayload {
  text: string
}
