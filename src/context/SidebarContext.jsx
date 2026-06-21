// Simple helper — sidebar dispatches 'sidebar-toggled' event on toggle
export function notifySidebarToggled() {
  window.dispatchEvent(new CustomEvent('sidebar-toggled'))
}
