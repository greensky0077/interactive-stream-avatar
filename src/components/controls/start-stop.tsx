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

  // Enhanced session validation
  function isSessionValid(): boolean {
    const hasSessionData = Boolean(sessionData?.sessionId)
    const hasActiveStream = Boolean(avatarRef.current?.mediaStream?.active)
    const isActive = Boolean(isSessionActive)
    
    // Log validation details for debugging
    if (!hasSessionData) {
      setDebug("Session validation failed: No session data")
      return false
    }
    if (!hasActiveStream) {
      setDebug("Session validation failed: Media stream not active")
      return false
    }
    if (!isActive) {
      setDebug("Session validation failed: Session not marked as active")
      return false
    }
    
    return true
  }

  // Keep-alive function to prevent session expiration
  async function keepAlive() {
    if (!sessionData?.sessionId) {
      setDebug("Keep-alive skipped: No session ID")
      return false
    }
    
    try {
      const response = await fetch("/api/keepalive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionData.sessionId }),
      })
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        const errorMsg = error.error || response.statusText || "Unknown error"
        setDebug(`Keep-alive failed (${response.status}): ${errorMsg}`)
        
        // If session is closed, mark as inactive
        if (errorMsg.includes("closed") || response.status === 400) {
          setDebug("Session appears to be closed, marking as inactive")
          setIsSessionActive(false)
        }
        
        return false
      }
      
      // Success - log occasionally to avoid spam
      const now = Date.now()
      if (!(window as any).lastKeepAliveLog || now - (window as any).lastKeepAliveLog > 30000) {
        setDebug("Keep-alive successful")
        ;(window as any).lastKeepAliveLog = now
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
    
    // Immediate keep-alive call
    keepAlive().then(success => {
      if (!success) {
        setDebug("Initial keep-alive failed")
      }
    })
    
    // Then set up interval for regular keep-alive
    keepAliveIntervalRef.current = setInterval(async () => {
      const success = await keepAlive()
      if (!success) {
        setDebug("Keep-alive failed, session may expire")
        // Try to restart session if keep-alive consistently fails
        setTimeout(() => {
          if (!isSessionValid()) {
            setDebug("Session appears expired, please restart")
          }
        }, 2000)
      }
    }, 5000) // Call every 5 seconds for faster response
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
          activity_idle_timeout: 300, // 5 minutes - more conservative
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