import { Background } from "./background"
import { Session } from "./session"
import { RagPanel } from "../rag/rag-panel"

export function Playground() {
  return (
    <form className="grid w-full items-start gap-4">
      <Session />
      <RagPanel />
      <Background />
    </form>
  )
}
