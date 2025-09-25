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
  keepAliveFunctionAtom,
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
  const [, setKeepAliveFunction] = useAtom(keepAliveFunctionAtom) as [
    (() => Promise<boolean>) | null,
    (value: (() => Promise<boolean>) | null) => void,
  ]

  const [avatar, setAvatar] = useAtom(avatarAtom) as [
    { current: StreamingAvatarApi | undefined },
    (value: { current: StreamingAvatarApi | undefined }) => void,
  ]
  const avatarRef = useRef<StreamingAvatarApi | undefined>()
  useEffect(() => {
    setAvatar(avatarRef)
  }, [setAvatar])

  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const backoffRef = useRef<number>(1000)
  const connectionStateRef = useRef<string>("new")
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearHeartbeat() {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
  }

  function clearReconnectTimeout() {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }

  function setupWebRTCConnectionMonitoring() {
    if (!avatarRef.current?.mediaStream) return

    // Try to get peer connection from video track
    const videoTrack = avatarRef.current.mediaStream.getVideoTracks()[0]
    if (!videoTrack) return

    // Access peer connection through the track's sender (using any for WebRTC internals)
    const sender = (videoTrack as any).sender?.transport?.iceTransport?.getConnectionState?.() ||
                  (videoTrack as any).getSettings?.()?.peerConnection ||
                  null
    
    if (!sender) {
      // Fallback: monitor media stream state changes
      setDebug("Using fallback connection monitoring")
      const checkConnection = () => {
        const isActive = avatarRef.current?.mediaStream?.active
        if (!isActive && connectionStateRef.current !== 'closed') {
          setConnectionHealth("degraded" as any)
          setDebug("Media stream inactive. Attempting to reconnect...")
          clearReconnectTimeout()
          reconnectTimeoutRef.current = setTimeout(() => safeRestart(), 2000)
        }
      }
      
      // Check every 5 seconds
      const interval = setInterval(checkConnection, 5000)
      return () => clearInterval(interval)
    }

    // Monitor ICE connection state changes
    sender.addEventListener('iceconnectionstatechange', () => {
      const state = sender.iceConnectionState
      connectionStateRef.current = state
      setDebug(`ICE connection state: ${state}`)
      
      if (state === 'disconnected' || state === 'failed') {
        setConnectionHealth("degraded" as any)
        setDebug(`WebRTC connection lost: ${state}. Attempting to reconnect...`)
        
        // Clear any existing reconnect timeout
        clearReconnectTimeout()
        
        // Schedule reconnection attempt
        reconnectTimeoutRef.current = setTimeout(() => {
          if (connectionStateRef.current === 'disconnected' || connectionStateRef.current === 'failed') {
            safeRestart()
          }
        }, 2000) // Wait 2 seconds before attempting reconnection
      } else if (state === 'connected' || state === 'completed') {
        setConnectionHealth("ok" as any)
        clearReconnectTimeout()
        setDebug(`WebRTC connection restored: ${state}`)
      }
    })

    // Monitor connection state changes
    sender.addEventListener('connectionstatechange', () => {
      const state = sender.connectionState
      setDebug(`Connection state: ${state}`)
      
      if (state === 'failed') {
        setConnectionHealth("offline" as any)
        setDebug("Connection failed. Attempting to reconnect...")
        clearReconnectTimeout()
        reconnectTimeoutRef.current = setTimeout(() => safeRestart(), 1000)
      }
    })
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

  // Helper function to call keep-alive before user interactions
  async function keepAliveBeforeAction() {
    const sid = sessionData?.sessionId
    if (!sid) return false

    try {
      const res = await fetch("/api/keepalive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sid }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({} as any))
        const message = (payload && (payload.error || payload.message)) || res.statusText
        setDebug(`Keep-alive failed: ${message}`)
        return false
      }
      return true
    } catch (e: any) {
      setDebug(`Keep-alive error: ${e?.message || "unknown"}`)
      return false
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
    return () => {
      clearHeartbeat()
      clearReconnectTimeout()
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
            activity_idle_timeout: 1800, // 30 minutes (max 3599s, default 120s)
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
      
      // Set keep-alive function for other components to use
      setKeepAliveFunction(() => keepAliveBeforeAction())
      
      // Setup WebRTC connection monitoring
      setTimeout(() => setupWebRTCConnectionMonitoring(), 1000)
      
      // attach track-end reconnect
      try {
        const ms = avatarRef.current.mediaStream
        ms?.getVideoTracks()?.forEach((t) => (t.onended = () => safeRestart()))
        ms?.getAudioTracks()?.forEach((t) => (t.onended = () => safeRestart()))
      } catch {}
      
      // start heartbeat (call keep-alive every 10 minutes to prevent session timeout)
      clearHeartbeat()
      backoffRef.current = 1000
      heartbeatTimerRef.current = setInterval(checkAlive, 600000) // 10 minutes (600s) - well before 30min timeout
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
    clearReconnectTimeout()
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
