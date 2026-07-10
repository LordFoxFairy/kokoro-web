import { LoginGate } from "@/ui/auth/login-gate"
import { SessionShell } from "@/ui/shell/session-shell"

export default function Home() {
  return (
    <LoginGate>
      <SessionShell />
    </LoginGate>
  )
}
