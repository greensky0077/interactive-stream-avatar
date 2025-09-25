import { useEffect, useRef, useState } from "react"
import { generateText } from "ai"
import { useChat } from "ai/react"
import { chromeai } from "chrome-ai"
import { AnimatePresence, motion } from "framer-motion"
import { useAtom } from "jotai"
import {
  ArrowUp,
  BotMessageSquareIcon,
  Mic,
  Paperclip,
  PauseIcon,
  SpeechIcon,
} from "lucide-react"

import {
  avatarAtom,
  chatModeAtom,
  debugAtom,
  inputTextAtom,
  isSessionActiveAtom,
  providerModelAtom,
  sessionDataAtom,
} from "@/lib/atoms"

import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { Switch } from "../ui/switch"
import { Textarea } from "../ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"

export function Chat() {
  const [avatar] = useAtom(avatarAtom)
  const [inputText, setInputText] = useAtom(inputTextAtom)
  const [sessionData] = useAtom(sessionDataAtom)
  const [isSessionActive, setIsSessionActive] = useAtom(isSessionActiveAtom)
  const [, setDebug] = useAtom(debugAtom)
  const [chatMode, setChatMode] = useAtom(chatModeAtom)
  const [providerModel, setProviderModel] = useAtom(providerModelAtom)
  const [isLoadingChat, setIsLoadingChat] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [showFallback, setShowFallback] = useState(false)
  const actionTimesRef = useRef<number[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const vadEnabledRef = useRef<boolean>(false)
  const vadSilenceTimerRef = useRef<any>(null)
  
  // Simple session validation
  function isSessionValid(): boolean {
    return Boolean(
      isSessionActive && 
      sessionData?.sessionId && 
      avatar.current
    )
  }

  // Simplified keep-alive function for chat operations
  async function keepAlive(): Promise<boolean> {
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
      
      return true
    } catch (e: any) {
      setDebug(`Keep-alive error: ${e.message}`)
      return false
    }
  }

  function isRateLimited(limit = 3, windowMs = 5000): boolean {
    const now = Date.now()
    actionTimesRef.current = actionTimesRef.current.filter((t) => now - t <= windowMs)
    if (actionTimesRef.current.length >= limit) {
      return true
    }
    actionTimesRef.current.push(now)
    return false
  }

  async function getMicStream(): Promise<MediaStream> {
    if (audioStreamRef.current) return audioStreamRef.current
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioStreamRef.current = stream
    return stream
  }

  function stopMic() {
    mediaRecorderRef.current?.stop()
    audioStreamRef.current?.getTracks().forEach((t) => t.stop())
    audioStreamRef.current = null
    mediaRecorderRef.current = null
  }

  function startPTTRecording(onChunk: (blob: Blob) => void) {
    if (!audioStreamRef.current) return
    const rec = new MediaRecorder(audioStreamRef.current, { mimeType: "audio/webm;codecs=opus" })
    mediaRecorderRef.current = rec
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) onChunk(e.data)
    }
    rec.start(250) // deliver chunks every 250ms
  }

  function startVAD(onChunk: (blob: Blob) => void) {
    if (!audioStreamRef.current) return
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const source = audioCtx.createMediaStreamSource(audioStreamRef.current)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    const rec = new MediaRecorder(audioStreamRef.current, { mimeType: "audio/webm;codecs=opus" })
    mediaRecorderRef.current = rec
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) onChunk(e.data)
    }

    const data = new Uint8Array(analyser.frequencyBinCount)
    const threshold = 8 // tweakable energy threshold
    const silenceMs = 1200

    function tick() {
      if (!vadEnabledRef.current) return
      analyser.getByteTimeDomainData(data)
      // simple energy check
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = data[i] - 128
        sum += Math.abs(v)
      }
      const energy = sum / data.length
      if (energy > threshold) {
        if (rec.state === "inactive") rec.start(250)
        if (vadSilenceTimerRef.current) {
          clearTimeout(vadSilenceTimerRef.current)
          vadSilenceTimerRef.current = null
        }
      } else {
        if (!vadSilenceTimerRef.current && rec.state === "recording") {
          vadSilenceTimerRef.current = setTimeout(() => {
            try { rec.stop() } catch {}
          }, silenceMs)
        }
      }
      requestAnimationFrame(tick)
    }
    vadEnabledRef.current = true
    requestAnimationFrame(tick)
  }

  const {
    input,
    setInput,
    handleSubmit,
    handleInputChange,
    messages,
    isLoading,
    error,
    stop,
  } = useChat({
    api: "/api/chat",
    onResponse: (response) => {
      console.log("ChatGPT Response:", response)
    },
    onFinish: async () => {
      setIsLoadingChat(false)
    },
    onError: (error) => {
      console.error("Error:", error)
      setIsLoadingChat(false)
      
      // Check if it's a geographic restriction error
      if (error.message?.includes("not available in your region") || 
          error.message?.includes("GEOGRAPHIC_RESTRICTION")) {
        setChatError("OpenAI is not available in your region. Please use a VPN or try alternative AI models.")
        setShowFallback(true)
      } else {
        setChatError(error.message || "Chat error occurred")
      }
    },
    initialMessages: [
      {
        id: "1",
        role: "system",
        content: "You are a helpful assistant.",
      },
    ],
    sendExtraMessageFields: true,
  })

  // ----- Auto-converse (STT -> Chat -> Auto-speak) -----
  const sttRef = useRef<any>(null)
  const [autoConverse, setAutoConverse] = useState(false)

  function ensureSTT(): boolean {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setDebug("SpeechRecognition not supported in this browser")
      return false
    }
    if (!sttRef.current) {
      const recog = new SR()
      recog.lang = "en-US"
      recog.continuous = true
      recog.interimResults = true
      recog.onresult = (e: any) => {
        let finalText = ""
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]
          if (res.isFinal) {
            finalText += res[0].transcript
          }
        }
        finalText = finalText.trim()
        if (finalText) {
          setInput(finalText)
          // submit after brief debounce to avoid duplicate finals
          setTimeout(() => {
            try {
              handleSubmit(new Event("submit") as any)
            } catch {}
          }, 50)
        }
      }
      recog.onerror = (ev: any) => setDebug(`STT error: ${ev.error || "unknown"}`)
      recog.onend = () => {
        if (autoConverse) {
          try { recog.start() } catch {}
        }
      }
      sttRef.current = recog
    }
    return true
  }

  async function toggleAutoConverse() {
    if (!autoConverse) {
      if (!ensureSTT()) return
      try { sttRef.current.start() } catch {}
      // ensure mic available for VAD as well (optional)
      try { await getMicStream() } catch {}
      if (!vadEnabledRef.current) startVAD(() => {})
      setAutoConverse(true)
      setDebug("Auto-converse enabled")
    } else {
      try { sttRef.current?.stop() } catch {}
      vadEnabledRef.current = false
      stopMic()
      setAutoConverse(false)
      setDebug("Auto-converse disabled")
    }
  }

  async function handleSpeak() {
    if (isRateLimited()) {
      setChatError("Please wait a moment before sending again.")
      if (typeof window !== "undefined") {
        window.alert("You are sending too quickly. Please wait a few seconds and try again.")
      }
      return
    }
    
    // Prevent empty input
    if (!input || !String(input).trim()) {
      setDebug("Please enter a message first")
      return
    }

    // Simple session validation
    if (!isSessionValid()) {
      setDebug("No active session. Please start the avatar first.")
      return
    }

    // Prevent concurrent speak calls
    const speakingFlag = (avatar.current as any)._isSpeaking as boolean | undefined
    if (speakingFlag) {
      setDebug("Already speaking. Please wait or interrupt")
      return
    }

    try {
      // Keep session alive before speaking
      await keepAlive()
      
      // mark speaking (best-effort)
      ;(avatar.current as any)._isSpeaking = true
      await avatar.current.speak({
        taskRequest: { text: String(input).trim(), sessionId: sessionData!.sessionId },
      })
    } catch (e: any) {
      console.error("Speak error:", e)
      if (e.message?.includes("invalid session state: closed")) {
        setDebug("Session expired. Please restart the avatar.")
      } else {
        setDebug(e.message || "Failed to speak")
      }
    } finally {
      ;(avatar.current as any)._isSpeaking = false
    }
  }

  const sentenceBuffer = useRef("")
  const processedSentences = useRef(new Set())

  useEffect(() => {
    try {
      if (!messages || messages.length === 0) return
      const lastMsg = messages[messages.length - 1]
      if (!lastMsg || lastMsg.role !== "assistant") return

      // Normalize content to string
      let contentText = ""
      const raw = (lastMsg as any).content
      if (typeof raw === "string") {
        contentText = raw
      } else if (Array.isArray(raw)) {
        contentText = raw
          .map((p: any) => (typeof p === "string" ? p : p?.text ?? ""))
          .join(" ")
      }
      contentText = String(contentText || "").trim()
      if (!contentText) return

      // Check if session is valid
      if (!isSessionValid()) {
        return
      }

      // Update buffer with the latest message content
      sentenceBuffer.current += ` ${contentText}`.trim()

      // Split by sentence-ending punctuation
      const sentences = sentenceBuffer.current.split(/(?<=[.!?])/) 

      // Process sentences
      sentences.forEach((sentence) => {
        const trimmedSentence = sentence.trim()
        if (
          trimmedSentence &&
          /[.!?]$/.test(trimmedSentence) &&
          !processedSentences.current.has(trimmedSentence)
        ) {
          processedSentences.current.add(trimmedSentence)

              if (!avatar.current) return
              
              // Keep session alive before auto-speak
              keepAlive().then(() => {
                avatar.current
                  .speak({
                    taskRequest: {
                      text: trimmedSentence,
                      sessionId: sessionData!.sessionId,
                    },
                  })
                  .catch((e: any) => {
                    if (e?.message?.includes("invalid session state: closed")) {
                      setDebug("Session expired during auto-speak. Please restart the avatar.")
                    }
                  })
              })
        }
      })

      sentenceBuffer.current = ""
    } catch (e) {
      // swallow errors to avoid React overlay
      console.error("Auto-speak effect error")
    }
  }, [messages, avatar, sessionData, isSessionActive, setDebug])

  async function handleInterrupt() {
    // Simple session validation
    if (!isSessionValid()) {
      setDebug("No active session to interrupt")
      return
    }

    stop()

    try {
      // Keep session alive before interrupting
      await keepAlive()
      
      await avatar.current!.interrupt({
        interruptRequest: { sessionId: sessionData!.sessionId }
      })
    } catch (e: any) {
      console.error("Interrupt error:", e)
      if (e.message?.includes("invalid session state: closed")) {
        setDebug("Session expired. Please restart the avatar.")
      } else {
        setDebug(e.message || "Failed to interrupt")
      }
    }
  }

  return (
    <div>
      {/* Error Display */}
      {chatError && (
        <div className="mb-2 rounded-md bg-red-50 border border-red-200 p-3">
          <div className="flex">
            <div className="flex-shrink-0">
              <BotMessageSquareIcon className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Chat Error</h3>
              <div className="mt-2 text-sm text-red-700">
                <p>{chatError}</p>
                {showFallback && (
                  <div className="mt-2">
                    <p className="font-medium">Solutions:</p>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li>Use a VPN to change your location</li>
                      <li>Try alternative AI models (Anthropic Claude, Mistral)</li>
                      <li>Contact your administrator for API key configuration</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          if (isRateLimited()) {
            e.preventDefault()
            setChatError("Please wait a moment before sending again.")
            if (typeof window !== "undefined") {
              window.alert("You are sending too quickly. Please wait a few seconds and try again.")
            }
            return
          }
          handleSubmit(e)
        }}
      >
        <div className="mb-2 flex w-full items-center justify-end space-x-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Label
              htmlFor="chat-mode"
              className="flex flex-row items-center space-x-1"
            >
              <SpeechIcon className="size-5" />
              <p>Repeat</p>
            </Label>
          </TooltipTrigger>
          <TooltipContent side="top">Repeat the input text</TooltipContent>
        </Tooltip>

        <Switch
          id="chat-mode"
          className="data-[state=unchecked]:bg-primary"
          defaultChecked={chatMode}
          onCheckedChange={() => setChatMode(!chatMode)}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Label
              htmlFor="chat-mode"
              className="flex flex-row items-center space-x-1"
            >
              <p>Chat</p>
              <BotMessageSquareIcon className="size-5" />
            </Label>
          </TooltipTrigger>
          <TooltipContent side="top">Chat</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex w-full items-center">
        <div className="bg-default flex w-full flex-col gap-1.5 rounded-[26px] border bg-background p-1.5 transition-colors">
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="flex flex-col">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                  >
                    <Paperclip className="size-5" />
                    <Input multiple={false} type="file" className="hidden" />
                    <span className="sr-only">Attach file</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Attach File</TooltipContent>
              </Tooltip>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <Textarea
                id="prompt-textarea"
                data-id="root"
                name="prompt"
                value={input}
                onChange={handleInputChange}
                dir="auto"
                rows={1}
                className="h-[40px] min-h-[40px] resize-none overflow-y-hidden rounded-none border-0 px-0 shadow-none focus:ring-0 focus-visible:ring-0"
              />
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  onMouseDown={async () => {
                    try {
                      await getMicStream()
                      startPTTRecording(() => {})
                      setDebug("PTT: recording...")
                    } catch (e: any) {
                      setDebug(e?.message || "Mic permission denied")
                    }
                  }}
                  onMouseUp={() => {
                    stopMic()
                    setDebug("PTT: stopped")
                  }}
                  onTouchStart={async () => {
                    try {
                      await getMicStream()
                      startPTTRecording(() => {})
                      setDebug("PTT: recording...")
                    } catch (e: any) {
                      setDebug(e?.message || "Mic permission denied")
                    }
                  }}
                  onTouchEnd={() => {
                    stopMic()
                    setDebug("PTT: stopped")
                  }}
                >
                  <Mic className="size-5" />
                  <span className="sr-only">Use Microphone</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Use Microphone</TooltipContent>
            </Tooltip>

            <Button
              // disabled={!isLoading}
              size="icon"
              type="button"
              className="rounded-full"
              onClick={handleInterrupt}
            >
              <PauseIcon className="size-5" />
            </Button>

            <Button
              // disabled={!isLoading}
              size="icon"
              type={chatMode ? "submit" : "button"}
              className="rounded-full"
              onClick={() => {
                if (!chatMode) {
                  handleSpeak()
                }
              }}
            >
              <ArrowUp className="size-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              onClick={async () => {
                try {
                  if (!audioStreamRef.current) await getMicStream()
                  if (!vadEnabledRef.current) {
                    startVAD(() => {})
                    setDebug("VAD: enabled")
                  } else {
                    vadEnabledRef.current = false
                    stopMic()
                    setDebug("VAD: disabled")
                  }
                } catch (e: any) {
                  setDebug(e?.message || "Mic permission denied")
                }
              }}
            >
              V
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              onClick={toggleAutoConverse}
            >
              A
            </Button>
          </div>
        </div>
      </div>
    </form>
    </div>
  )
}
