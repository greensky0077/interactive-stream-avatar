import { RefObject } from "react"
import {
  NewSessionData,
  NewSessionRequestQualityEnum,
  StreamingAvatarApi,
} from "@heygen/streaming-avatar"
import { atom } from "jotai"

import { NavItem } from "./types"
import { defaultAvatarId, defaultVoiceId } from "./heygen-presets"

//Stream Atoms
export const mediaStreamActiveAtom = atom<Boolean>(false)
export const sessionDataAtom = atom<NewSessionData | undefined>(undefined)
export const streamAtom = atom<MediaStream | undefined>(undefined)
export const debugAtom = atom<string>("")
export const inputTextAtom = atom<string>("")
export const avatarIdAtom = atom<string>(defaultAvatarId)
export const voiceIdAtom = atom<string>(defaultVoiceId)
export const qualityAtom = atom<NewSessionRequestQualityEnum>("medium")
export const mediaStreamRefAtom = atom<RefObject<HTMLVideoElement> | null>(null)
export const mediaCanvasRefAtom = atom<RefObject<HTMLCanvasElement> | null>(
  null
)
export const avatarAtom = atom<RefObject<StreamingAvatarApi> | undefined>(
  undefined
)
// Expose a global restart hook so other components can request reconnection
export const restartFnAtom = atom<(() => Promise<void>) | null>(null)

//UI Atoms
export const selectedNavItemAtom = atom<NavItem>({
  label: "Playground",
  icon: "",
  ariaLabel: "Playground",
  content: "",
})
export const publicAvatarsAtom = atom([])
export const removeBGAtom = atom(false)
export const isRecordingAtom = atom(false)
export const chatModeAtom = atom(false)
export const customBgPicAtom = atom<string>("")

//LLMs Atoms
export const providerModelAtom = atom("openai:gpt-4-turbo")
export const temperatureAtom = atom(1)
export const maxTokensAtom = atom(256)

// Connection/health atoms
export const lastHeartbeatAtAtom = atom<number | null>(null)
export const consecutiveFailuresAtom = atom<number>(0)
export const connectionHealthAtom = atom<"ok" | "degraded" | "offline">("ok")
export const lastErrorAtom = atom<string>("")
