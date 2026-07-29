import { site } from "../site-bootstrap";

export default function Home() {
  return (
    <main>
      <p className="eyebrow">Independent AI workspace</p>
      <h1>{site.displayName}</h1>
      <p>This deployment owns its project, release, domain, cookies, and rollback authority.</p>
    </main>
  );
}
