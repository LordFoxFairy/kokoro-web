import { referenceSite } from "../site-bootstrap";

export default function Page() {
  return (
    <main>
      <span>Contract fixture</span>
      <h1>{referenceSite.displayName}</h1>
      <p>One project. One release. One domain binding. One rollback authority.</p>
    </main>
  );
}
