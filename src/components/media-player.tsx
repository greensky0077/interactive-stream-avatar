import React, { RefObject, useEffect, useRef } from "react"
import { useAtom } from "jotai"
import { ChevronRightIcon } from "lucide-react"

import { customBgPicAtom, debugAtom, isSessionActiveAtom } from "@/lib/atoms"
import { cn } from "@/lib/utils"

import { MediaControls } from "./controls/media-controls"
import { StartStop } from "./controls/start-stop"
import ImageWrap from "./image-wrap"
import VideoWrap from "./video-wrap"

function MediaPlayer() {
  const [customBgPic] = useAtom(customBgPicAtom)
  const [debug, setDebug] = useAtom(debugAtom)
  const [isSessionActive] = useAtom(isSessionActiveAtom)

  return (
    <div className="flex h-full w-full flex-col items-center justify-center space-y-1">
      <StartStop />
      <div
        className="relative flex flex-none flex-col justify-end overflow-hidden rounded-3xl border text-white"
        // [box-shadow:0_8px_34px_rgba(0,0,0,.5)]
        style={{
          backgroundImage: customBgPic ? `url(${customBgPic})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
          // width: "100%",
          // height: "500px",
        }}
      >
        <VideoWrap />
        <ImageWrap />
      </div>
      <MediaControls />
      <footer className="sticky bottom-0 mt-auto flex w-[500px] flex-row items-center justify-between rounded-md border py-4 font-mono text-sm px-3">
        <div className="flex items-center gap-2">
          <ChevronRightIcon className="h-4 w-4" />
          <p>{debug}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("px-2 py-0.5 rounded-md border", isSessionActive ? "text-green-600 border-green-600" : "text-red-600 border-red-600")}>
            {isSessionActive ? "Active" : "Inactive"}
          </span>
        </div>
      </footer>
    </div>
  )
}

export default MediaPlayer
