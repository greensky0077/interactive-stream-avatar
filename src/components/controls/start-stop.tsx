import { RefObject, useEffect, useRef } from "react"
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
  mediaStreamRefAtom,
  lastErrorAtom,
  publicAvatarsAtom,
  qualityAtom,
  sessionDataAtom,
  streamAtom,
  voiceIdAtom,
  isSessionActiveAtom,
} from "@/lib/atoms"

import { Button } from "../ui/button"

export function StartStop() {
  const [isSessionActive, setIsSessionActive] = useAtom(isSessionActiveAtom)
  const [quality, setQuality] = useAtom(qualityAtom)
  const [avatarId, setAvatarId] = useAtom(avatarIdAtom)
  const [publicAvatars] = useAtom(publicAvatarsAtom)
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
  const avatarRef = useRef<StreamingAvatarApi | undefined>()
  useEffect(() => {
    setAvatar(avatarRef)
  }, [setAvatar])

  const isStartingRef = useRef(false)
  const keepAliveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Simple session validation
  function isSessionValid(): boolean {
    return Boolean(
      isSessionActive && 
      sessionData?.sessionId && 
      avatarRef.current?.mediaStream?.active
    )
  }

  // Keep-alive function to prevent session expiration
  async function keepAlive() {
    if (!sessionData?.sessionId) return false
    
    try {
      const response = await fetch("/api/keepalive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionData.sessionId }),
      })
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        setDebug(`Keep-alive failed: ${error.error || response.statusText}`)
        return false
      }
      
      return true
    } catch (e: any) {
      setDebug(`Keep-alive error: ${e.message}`)
      return false
    }
  }

  // Start keep-alive interval
  function startKeepAlive() {
    clearKeepAlive()
    keepAliveIntervalRef.current = setInterval(async () => {
      const success = await keepAlive()
      if (!success) {
        setDebug("Keep-alive failed, session may expire")
      }
    }, 10000) // Call every 10 seconds
  }

  // Clear keep-alive interval
  function clearKeepAlive() {
    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current)
      keepAliveIntervalRef.current = null
    }
  }

  // Clean session state
  function clearSession() {
    clearKeepAlive()
    setIsSessionActive(false)
    setSessionData(undefined)
    setStream(undefined)
    avatarRef.current = undefined
  }

  useEffect(() => {
    if (stream && mediaStreamRef?.current) {
      mediaStreamRef.current.srcObject = stream
      mediaStreamRef.current.onloadedmetadata = () => {
        mediaStreamRef.current!.play()
        setDebug("Playing")
        setIsSessionActive(true)

        // Get video dimensions
        const videoWidth = mediaStreamRef.current!.videoWidth
        const videoHeight = mediaStreamRef.current!.videoHeight
        console.log("Video dimensions:", videoWidth, videoHeight)
      }
    }
  }, [mediaStreamRef, stream])

  async function startSession() {
    if (isStartingRef.current) {
      setDebug("Already starting a session...")
      return
    }

    if (!avatarId) {
      setDebug("Please select an Avatar ID")
      return
    }

    // Clean up any existing session
    if (avatarRef.current && sessionData?.sessionId) {
      try {
        await avatarRef.current.stopAvatar(
          { stopSessionRequest: { sessionId: sessionData.sessionId } },
          setDebug
        )
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    clearSession()

    isStartingRef.current = true

    try {
      // Get token
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

      // Create avatar API instance
      avatarRef.current = new StreamingAvatarApi(
        new Configuration({
          accessToken: data.data.data.token,
        })
      )
      
      // Start session with timeout configuration
      const payload: any = {
        newSessionRequest: {
          quality: quality,
          avatarName: avatarId,
          activity_idle_timeout: 1800, // 30 minutes
        },
      }

      const res = await avatarRef.current.createStartAvatar(payload, setDebug)
      
      // Set session data
      setSessionData(res)
      setStream(avatarRef.current.mediaStream)
      setIsSessionActive(true)
      setDebug("Session started successfully")
      
      // Start keep-alive to prevent session expiration
      startKeepAlive()

    } catch (e: any) {
      const message = e?.message || "Failed to start avatar session"
      setDebug(message)
      setLastError(message)
      clearSession()
    } finally {
      isStartingRef.current = false
    }
  }

  async function stopSession() {
    if (!isSessionValid()) {
      setDebug("No active session to stop")
      return
    }

    setIsSessionActive(false)
    
    try {
      await avatarRef.current!.stopAvatar(
        { stopSessionRequest: { sessionId: sessionData!.sessionId } },
        setDebug
      )
      setDebug("Session stopped successfully")
    } catch (e: any) {
      const message = e?.message || "Failed to stop avatar"
      setDebug(message)
      setLastError(message)
    } finally {
      clearSession()
    }
  }

  return (
    <div className="relative space-x-1">
      <Button 
        onClick={startSession} 
        variant="ghost" 
        size="icon"
        disabled={isStartingRef.current}
      >
        <PlayIcon className="size-4" />
      </Button>
      <Button 
        onClick={stopSession} 
        variant="ghost" 
        size="icon"
        disabled={!isSessionValid()}
      >
        <SquareIcon className="size-4" />
      </Button>
      <Button 
        onClick={stopSession} 
        variant="ghost" 
        size="icon"
        disabled={!isSessionValid()}
      >
        <RefreshCcw className="size-4" />
      </Button>
    </div>
  )
}