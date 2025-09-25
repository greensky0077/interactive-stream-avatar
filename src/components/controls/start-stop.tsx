import { RefObject, useEffect, useRef, useState } from "react"
import {
  Configuration,
  NewSessionData,
  StreamingAvatarApi,
} from "@heygen/streaming-avatar"
import { useAtom } from "jotai"
import { PlayIcon, RefreshCcw, SquareIcon } from "lucide-react"

import {
  avatarAtom,
  avatarIdAtom,
  debugAtom,
  mediaCanvasRefAtom,
  mediaStreamActiveAtom,
  mediaStreamRefAtom,
  lastHeartbeatAtAtom,
  consecutiveFailuresAtom,
  connectionHealthAtom,
  lastErrorAtom,
  publicAvatarsAtom,
  qualityAtom,
  sessionDataAtom,
  streamAtom,
  voiceIdAtom,
  restartFnAtom,
} from "@/lib/atoms"

import { Button } from "../ui/button"

export function StartStop() {
  const [mediaStreamActive, setMediaStreamActive] = useAtom(
    mediaStreamActiveAtom
  )
  const [quality, setQuality] = useAtom(qualityAtom)
  const [avatarId, setAvatarId] = useAtom(avatarIdAtom)
  const [publicAvatars] = useAtom(publicAvatarsAtom)
  const [consecutiveFailures, setConsecutiveFailures] = useAtom(consecutiveFailuresAtom)
  const [, _setLastBeat] = useAtom(lastHeartbeatAtAtom as any)
  const [, setConnectionHealth] = useAtom(connectionHealthAtom)
  const [, setLastError] = useAtom(lastErrorAtom)
  const [mediaStreamRef] = useAtom(mediaStreamRefAtom)
  const [mediaCanvasRef] = useAtom(mediaCanvasRefAtom)
  const [sessionData, setSessionData] = useAtom(sessionDataAtom) as [
    NewSessionData | undefined,
    (sessionData: NewSessionData | undefined) => void,
  ]
  const [stream, setStream] = useAtom(streamAtom) as [
    MediaStream | undefined,
    (stream: MediaStream | undefined) => void,
  ]
  const [, setDebug] = useAtom(debugAtom)

  const [avatar, setAvatar] = useAtom(avatarAtom) as [
    { current: StreamingAvatarApi | undefined },
    (value: { current: StreamingAvatarApi | undefined }) => void,
  ]
  const [, setRestartFn] = useAtom(restartFnAtom) as [
    (() => Promise<void>) | null,
    (fn: (() => Promise<void>) | null) => void
  ]
  const avatarRef = useRef<StreamingAvatarApi | undefined>()
  useEffect(() => {
    setAvatar(avatarRef)
  }, [setAvatar])

  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const backoffRef = useRef<number>(1000)

  function clearHeartbeat() {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
  }

  async function checkAlive() {
    try {
      const hasActiveMedia = Boolean(avatarRef.current?.mediaStream?.active)
      const sid = sessionData?.sessionId
      if (!sid) throw new Error("no sessionId")

      // Call server keepalive to reset HeyGen idle timer with a brief retry
      async function once() {
        const res = await fetch("/api/keepalive", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_id: sid }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => ({} as any))
          const message = (payload && (payload.error || payload.message)) || res.statusText
          throw new Error(String(message || "keepalive failed"))
        }
      }
      try {
        await once()
      } catch (err) {
        await new Promise((r) => setTimeout(r, 300))
        await once()
      }

      if (hasActiveMedia) {
        _setLastBeat(Date.now() as any)
        setConsecutiveFailures(0)
        setConnectionHealth("ok" as any)
        return
      }
      // media stream inactive despite keepalive
      throw new Error("mediaStream inactive")
    } catch (e: any) {
      setConsecutiveFailures((n) => n + 1)
      setLastError(e?.message || "heartbeat failed")
      const fails = consecutiveFailures + 1
      if (fails >= 2) setConnectionHealth("degraded" as any)
      if (fails >= 4) {
        setConnectionHealth("offline" as any)
        await safeRestart()
      }
    }
  }

  async function safeRestart() {
    if (isStartingRef.current) return
    setDebug("Reconnecting...")
    clearHeartbeat()
    try {
      await stop()
    } catch {}
    await new Promise((r) => setTimeout(r, backoffRef.current))
    backoffRef.current = Math.min(backoffRef.current * 2, 10000)
    await grab()
  }

  useEffect(() => {
    if (stream && mediaStreamRef?.current) {
      mediaStreamRef.current.srcObject = stream
      mediaStreamRef.current.onloadedmetadata = () => {
        mediaStreamRef.current!.play()
        setDebug("Playing")
        setMediaStreamActive(true)

        // Get video dimensions
        const videoWidth = mediaStreamRef.current!.videoWidth
        const videoHeight = mediaStreamRef.current!.videoHeight
        console.log("Video dimensions:", videoWidth, videoHeight)
      }
    }
    // expose restart function globally
    setRestartFn(safeRestart)
    return () => {
      clearHeartbeat()
      setRestartFn(null)
    }
  }, [mediaStreamRef, stream])

  const isStartingRef = useRef(false)

  async function grab() {
    if (isStartingRef.current) {
      setDebug("Already starting a session...")
      return
    }

    if (!avatarId) {
      setDebug("Please select an Avatar ID")
      return
    }
    // voice is optional; server will assign compatible default

    // If there is a previous instance lingering, try to stop/cleanup
    try {
      if (avatarRef.current && sessionData?.sessionId) {
        await avatarRef.current.stopAvatar(
          { stopSessionRequest: { sessionId: sessionData.sessionId } },
          setDebug
        )
      }
    } catch (e) {
      // ignore, we are about to recreate; avoid propagating library close errors
    } finally {
      avatarRef.current = undefined
      setStream(undefined)
      setSessionData(undefined)
      setMediaStreamActive(false)
    }

    isStartingRef.current = true

    const response = await fetch("/api/grab", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`)
    }
    const data = await response.json()

    try {
      avatarRef.current = new StreamingAvatarApi(
        new Configuration({
          accessToken: data.data.data.token,
        })
      )
      
      // attempt start with selected voiceId
      const attemptStart = async (voice?: string) => {
        const payload: any = {
          newSessionRequest: {
            quality: quality, // low, medium, high
            avatarName: avatarId,
          },
        }
        if (voice) payload.newSessionRequest.voice = { voiceId: voice }

        return await avatarRef.current!.createStartAvatar(payload, setDebug)
      }

      let res: NewSessionData | undefined
      try {
        // start without explicit voice first to let server choose compatible one
        res = await attemptStart(undefined)
      } catch (err: any) {
        const msg = String(err?.message || "")
        // voice not supported — try avatar default voice if available
        if (msg.includes("voice is not supported")) {
          const fallback = (publicAvatars || []).find((a: any) => a.pose_id === avatarId)?.default_voice?.free as string | undefined
          try {
            if (fallback) {
              res = await attemptStart(fallback)
            }
          } catch {}
          // if still no res, try without voice to let server choose default
          if (!res) {
            try {
              res = await attemptStart(undefined)
            } catch {}
          }
        }
        // rethrow if still no success and not handled
        if (!res) throw err
      }

      setSessionData(res!)
      setStream(avatarRef.current.mediaStream)
      setMediaStreamActive(true)
      // attach track-end/mute reconnect
      try {
        const ms = avatarRef.current.mediaStream
        const attach = (t: MediaStreamTrack) => {
          t.onended = () => safeRestart()
          t.onmute = () => {
            // if muted for more than 2s, consider connection broken
            const tm = setTimeout(() => safeRestart(), 2000)
            t.onunmute = () => clearTimeout(tm)
          }
        }
        ms?.getVideoTracks()?.forEach(attach)
        ms?.getAudioTracks()?.forEach(attach)
      } catch {}
      // start heartbeat
      clearHeartbeat()
      backoffRef.current = 1000
      heartbeatTimerRef.current = setInterval(checkAlive, 15000)
    } catch (e: any) {
      const message = e?.message || "Failed to start avatar session"
      setDebug(message)
      // ensure cleanup to avoid library attempting to close undefined internals
      avatarRef.current = undefined
      setStream(undefined)
      setSessionData(undefined)
      setMediaStreamActive(false)
    } finally {
      isStartingRef.current = false
    }
  }

  async function stop() {
    // Guard: nothing to stop
    if (!avatarRef.current) {
      setDebug("Avatar not initialized")
      return
    }

    if (!sessionData?.sessionId) {
      setDebug("No active session to stop")
      return
    }

    setMediaStreamActive(false)
    clearHeartbeat()
    try {
      await avatarRef.current.stopAvatar(
        { stopSessionRequest: { sessionId: sessionData.sessionId } },
        setDebug
      )
    } catch (e: any) {
      // Some SDK versions throw if internal transport is already closed
      const message = e?.message || "Failed to stop avatar"
      if (message.toLowerCase().includes("close")) {
        setDebug("Session already closed")
      } else {
        setDebug(message)
      }
    } finally {
      // Clean up local refs/state regardless of SDK outcome
      setStream(undefined)
      setSessionData(undefined)
    }
  }

  return (
    <div className="relative space-x-1">
      <Button onClick={grab} variant="ghost" size="icon">
        <PlayIcon className="size-4" />
      </Button>
      <Button onClick={stop} variant="ghost" size="icon">
        <SquareIcon className="size-4" />
      </Button>
      <Button onClick={stop} variant="ghost" size="icon">
        <RefreshCcw className="size-4" />
      </Button>
    </div>
  )
}
