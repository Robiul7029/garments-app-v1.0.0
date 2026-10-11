import ErpDashboard from './ErpDashboard';

/**
 * The home route (`/`) — the new ERP Overview.
 *
 * This is deliberately unconditional. It previously branched on an ERP role and
 * fell back to the legacy Dashboard, which meant any account without an
 * `erpRole` on its `users/{uid}` document never saw the new screen at all — the
 * exact symptom of "I ran npm run and got the old dashboard back".
 *
 * The branch existed to avoid showing an "Access restricted" wall on the home
 * page. It does not need to: `ErpDashboard` does not render `DeniedState`. It
 * reads the live collections through `ErpDataContext`, and a role that may not
 * read a collection simply gets no rows there, so the screen degrades to its
 * own empty and "not available to your role" states instead of refusing to
 * load. That is a usable home page for every role, which the legacy fallback
 * was only pretending to be.
 *
 * No permission check and no loading gate are needed here as a result: there is
 * nothing left to decide, and a gate would only add a spinner in front of a
 * component that already renders its own loading state.
 */
export default function ErpHome() {
  return <ErpDashboard />;
}
