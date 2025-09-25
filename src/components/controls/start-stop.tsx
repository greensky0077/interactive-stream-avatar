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
  const keepAliveWorkerRef = useRef<Worker | null>(null)

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

  // Initialize Web Worker for keep-alive
  function initializeKeepAliveWorker() {
    if (keepAliveWorkerRef.current) {
      return keepAliveWorkerRef.current
    }

    try {
      // Create Web Worker from inline code
      const workerCode = `
        class KeepAliveWorker {
          constructor() {
            this.intervalId = null
            this.sessionId = null
            this.isActive = false
            self.addEventListener('message', this.handleMessage.bind(this))
          }

          handleMessage(event) {
            const { type, data } = event.data
            switch (type) {
              case 'START_KEEPALIVE':
                this.startKeepAlive(data.sessionId, data.interval)
                break
              case 'STOP_KEEPALIVE':
                this.stopKeepAlive()
                break
              case 'UPDATE_SESSION':
                this.sessionId = data.sessionId
                break
            }
          }

          async startKeepAlive(sessionId, interval = 5000) {
            if (this.isActive) this.stopKeepAlive()
            this.sessionId = sessionId
            this.isActive = true
            await this.sendKeepAlive()
            this.intervalId = setInterval(async () => {
              if (this.isActive && this.sessionId) {
                await this.sendKeepAlive()
              }
            }, interval)
            self.postMessage({ type: 'KEEPALIVE_STARTED', data: { sessionId, interval } })
          }

          stopKeepAlive() {
            this.isActive = false
            if (this.intervalId) {
              clearInterval(this.intervalId)
              this.intervalId = null
            }
            self.postMessage({ type: 'KEEPALIVE_STOPPED', data: { sessionId: this.sessionId } })
          }

          async sendKeepAlive() {
            if (!this.sessionId) return false
            try {
              const response = await fetch('/api/keepalive', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ session_id: this.sessionId }),
              })
              if (!response.ok) {
                const error = await response.json().catch(() => ({}))
                const errorMsg = error.error || response.statusText || 'Unknown error'
                self.postMessage({
                  type: 'KEEPALIVE_FAILED',
                  data: { sessionId: this.sessionId, status: response.status, error: errorMsg }
                })
                return false
              }
              const now = Date.now()
              if (!self.lastKeepAliveLog || now - self.lastKeepAliveLog > 30000) {
                self.postMessage({ type: 'KEEPALIVE_SUCCESS', data: { sessionId: this.sessionId } })
                self.lastKeepAliveLog = now
              }
              return true
            } catch (error) {
              self.postMessage({
                type: 'KEEPALIVE_ERROR',
                data: { sessionId: this.sessionId, error: error.message }
              })
              return false
            }
          }
        }
        new KeepAliveWorker()
      `

      const blob = new Blob([workerCode], { type: 'application/javascript' })
      const worker = new Worker(URL.createObjectURL(blob))
      
      // Handle worker messages
      worker.onmessage = (event) => {
        const { type, data } = event.data
        
        switch (type) {
          case 'KEEPALIVE_STARTED':
            setDebug(`Keep-alive worker started for session ${data.sessionId}`)
            break
          case 'KEEPALIVE_STOPPED':
            setDebug(`Keep-alive worker stopped for session ${data.sessionId}`)
            break
          case 'KEEPALIVE_SUCCESS':
            setDebug("Keep-alive successful")
            break
          case 'KEEPALIVE_FAILED':
            setDebug(`Keep-alive failed (${data.status}): ${data.error}`)
            if (data.error.includes("closed") || data.status === 400) {
              setDebug("Session appears to be closed, marking as inactive")
              setIsSessionActive(false)
            }
            break
          case 'KEEPALIVE_ERROR':
            setDebug(`Keep-alive error: ${data.error}`)
            break
        }
      }

      keepAliveWorkerRef.current = worker
      return worker
    } catch (error: any) {
      setDebug(`Failed to create keep-alive worker: ${error.message}`)
      return null
    }
  }

  // Start keep-alive using Web Worker
  function startKeepAlive() {
    clearKeepAlive()
    
    const worker = initializeKeepAliveWorker()
    if (!worker || !sessionData?.sessionId) {
      setDebug("Failed to start keep-alive worker")
      return
    }

    worker.postMessage({
      type: 'START_KEEPALIVE',
      data: { sessionId: sessionData.sessionId, interval: 5000 }
    })
  }

  // Clear keep-alive worker
  function clearKeepAlive() {
    if (keepAliveWorkerRef.current) {
      keepAliveWorkerRef.current.postMessage({ type: 'STOP_KEEPALIVE' })
      keepAliveWorkerRef.current.terminate()
      keepAliveWorkerRef.current = null
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

      // Monitor WebRTC connection state
      const videoElement = mediaStreamRef.current
      const track = stream.getVideoTracks()[0]
      
      if (track) {
        // Monitor track state changes
        track.addEventListener('ended', () => {
          setDebug("Video track ended - session may be expired")
          setIsSessionActive(false)
        })

        track.addEventListener('mute', () => {
          setDebug("Video track muted")
        })

        track.addEventListener('unmute', () => {
          setDebug("Video track unmuted")
        })
      }

      // Monitor video element events
      videoElement.addEventListener('error', (e) => {
        setDebug(`Video error: ${e}`)
        setIsSessionActive(false)
      })

      videoElement.addEventListener('stalled', () => {
        setDebug("Video stalled - connection may be poor")
      })

      videoElement.addEventListener('waiting', () => {
        setDebug("Video waiting for data")
      })

      videoElement.addEventListener('canplay', () => {
        setDebug("Video can play")
      })

      videoElement.addEventListener('canplaythrough', () => {
        setDebug("Video can play through")
      })
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
      
      // Start session with optimized configuration
      const payload: any = {
        newSessionRequest: {
          quality: quality,
          avatarName: avatarId,
          activity_idle_timeout: 120, // 2 minutes - very conservative for testing
          // Add additional session configuration
          enable_avatar_audio: true,
          enable_avatar_video: true,
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
      setDebug(`Session start failed: ${message}`)
      setLastError(message)
      
      // Enhanced error handling
      if (message.includes("invalid session state")) {
        setDebug("Session state error - clearing and retrying in 2 seconds")
        clearSession()
        setTimeout(() => {
          if (!isSessionValid()) {
            setDebug("Retrying session start...")
            startSession()
          }
        }, 2000)
      } else if (message.includes("network") || message.includes("timeout")) {
        setDebug("Network error - will retry automatically")
        clearSession()
        setTimeout(() => {
          if (!isSessionValid()) {
            setDebug("Retrying after network error...")
            startSession()
          }
        }, 5000)
      } else {
        clearSession()
      }
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