import { RefObject, useEffect, useRef, useState } from "react"
import { useAtom } from "jotai"

import {
  mediaCanvasRefAtom,
  isSessionActiveAtom,
  mediaStreamRefAtom,
  removeBGAtom,
} from "@/lib/atoms"
import { cn } from "@/lib/utils"

export default function VideoWrap() {
  const [removeBG] = useAtom(removeBGAtom)
  const [isSessionActive] = useAtom(isSessionActiveAtom)
  const [mediaStreamRef, setMediaStreamRef] = useAtom(mediaStreamRefAtom) as [
    RefObject<HTMLVideoElement> | undefined,
    (value: RefObject<HTMLVideoElement> | undefined) => void,
  ]
  const [mediaCanvasRef, setMediaCanvasRef] = useAtom(mediaCanvasRefAtom) as [
    RefObject<HTMLCanvasElement> | undefined,
    (value: RefObject<HTMLCanvasElement> | undefined) => void,
  ]

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    setMediaStreamRef(videoRef)
    setMediaCanvasRef(canvasRef)
  }, [setMediaStreamRef, setMediaCanvasRef])

  useEffect(() => {
    if (!removeBG || !isSessionActive || !mediaStreamRef || !mediaCanvasRef)
      return

    let animationFrameId: number | null = null
    let lastFrameTime = 0
    const targetFPS = 30 // Limit to 30 FPS to reduce resource usage
    const frameInterval = 1000 / targetFPS

    const renderCanvas = (currentTime: number) => {
      // Throttle rendering to reduce resource usage
      if (currentTime - lastFrameTime < frameInterval) {
        animationFrameId = requestAnimationFrame(renderCanvas)
        return
      }
      lastFrameTime = currentTime

      const video = mediaStreamRef.current
      const canvas = mediaCanvasRef.current
      if (!canvas || !video || video.videoWidth === 0 || video.videoHeight === 0) {
        animationFrameId = requestAnimationFrame(renderCanvas)
        return
      }

      const ctx = canvas.getContext("2d", { 
        willReadFrequently: true,
        alpha: true,
        desynchronized: true // Optimize for performance
      })
      if (!ctx) return

      // Only resize canvas if dimensions changed
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }

      // Use more efficient drawing method
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      // Optimize green screen removal with better performance
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data
      const dataLength = data.length

      // Process pixels in chunks to avoid blocking the main thread
      const chunkSize = 10000 // Process 10k pixels at a time
      let currentChunk = 0

      const processChunk = () => {
        const start = currentChunk * chunkSize
        const end = Math.min(start + chunkSize, dataLength)
        
        for (let i = start; i < end; i += 4) {
          const red = data[i]
          const green = data[i + 1]
          const blue = data[i + 2]

          // Optimized green detection
          if (green > 90 && red < 90 && blue < 90) {
            data[i + 3] = 0 // Set alpha channel to 0 (transparent)
          }
        }

        currentChunk++
        
        if (currentChunk * chunkSize < dataLength) {
          // Use setTimeout to yield control back to the browser
          setTimeout(processChunk, 0)
        } else {
          // All chunks processed, update canvas
          ctx.putImageData(imageData, 0, 0)
          animationFrameId = requestAnimationFrame(renderCanvas)
        }
      }

      processChunk()
    }

    // Start the optimized animation loop
    animationFrameId = requestAnimationFrame(renderCanvas)

    // Clean up function to cancel animation frame
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
    }
  }, [removeBG, isSessionActive, mediaStreamRef, mediaCanvasRef])

  return (
    <div id="videoWrap" className={cn(!isSessionActive && "hidden")}>
      <video
        playsInline
        autoPlay
        // width={500}
        ref={videoRef}
        className={cn("max-h-[500px] w-full", removeBG ? "hidden" : "flex")}
      ></video>
      <canvas
        ref={canvasRef}
        className={cn("max-h-[500px] w-full", !removeBG ? "hidden" : "flex")}
      ></canvas>
    </div>
  )
}
