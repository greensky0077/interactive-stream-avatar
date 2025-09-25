import { useEffect, useState } from "react"
import { NewSessionRequestQualityEnum } from "@heygen/streaming-avatar"
import { useAtom } from "jotai"

import {
  avatarIdAtom,
  publicAvatarsAtom,
  qualityAtom,
} from "@/lib/atoms"

import { Label } from "../ui/label"
import { interactiveAvatarIds } from "@/lib/heygen-presets"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"

export function Session() {
  const [publicAvatars, setPublicAvatars] = useAtom(publicAvatarsAtom)
  const [quality, setQuality] = useAtom(qualityAtom)
  const [avatarId, setAvatarId] = useAtom(avatarIdAtom)

  useEffect(() => {
    // Prefer real public list to get preview images; fallback to presets
    const loadAvatars = async () => {
      try {
        const res = await fetch("/public-streaming-avatars.json")
        if (res.ok) {
          const data = await res.json()
          if (data?.data?.avatar) {
            setPublicAvatars(data.data.avatar)
            return
          }
        }
        // fallback
        setPublicAvatars(
          interactiveAvatarIds.map((pose_id) => ({
            pose_id,
            pose_name: pose_id.replace(/_/g, " "),
            gender: "",
            // voice will be assigned by server if omitted
            normal_preview: "/default.png",
          }))
        )
      } catch (error) {
        console.error("Error fetching avatars, using presets:", error)
        setPublicAvatars(
          interactiveAvatarIds.map((pose_id) => ({
            pose_id,
            pose_name: pose_id.replace(/_/g, " "),
            gender: "",
            // voice will be assigned by server if omitted
            normal_preview: "/default.png",
          }))
        )
      }
    }
    loadAvatars()
  }, [])

  // voice selection removed — server default will be used

  return (
    <fieldset className="grid gap-6 rounded-lg border p-4">
      <legend className="-ml-1 px-1 text-sm font-medium">Session</legend>
      <div className="grid gap-3">
        <Label htmlFor="model">Avatar ID</Label>
        <Select value={avatarId} onValueChange={(x) => setAvatarId(x)}>
          <SelectTrigger
            id="model"
            className="items-start [&_[data-description]]:hidden"
          >
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            {publicAvatars.map((avatar) => (
              <SelectItem
                value={avatar.pose_id}
                key={avatar.pose_id}
                className="cursor-pointer"
              >
                <div className="flex items-start gap-3 text-muted-foreground">
                  {/* <Rabbit className="size-5" /> */}
                  <div className="grid gap-0.5">
                    <p>
                      <span className="pr-2 font-medium text-foreground">
                        {avatar.pose_name}
                      </span>
                      {avatar.gender}
                    </p>
                    <p className="text-xs" data-description>
                      {avatar.pose_id}
                    </p>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Voice selection removed intentionally. */}

      <div className="grid gap-3">
        <Label htmlFor="model">Bitrate</Label>
        <Select
          onValueChange={(x: NewSessionRequestQualityEnum) => setQuality(x)}
          defaultValue={quality}
        >
          <SelectTrigger className="items-start [&_[data-description]]:hidden">
            <SelectValue placeholder={quality} defaultValue={quality} />
          </SelectTrigger>
          <SelectContent>
            {["high", "medium", "low"].map((quality) => (
              <SelectItem
                value={quality}
                key={quality}
                className="cursor-pointer"
              >
                <div className="flex items-start gap-3 text-muted-foreground">
                  <div className="grid gap-0.5">
                    <p>
                      <span className="pr-2 font-medium capitalize text-foreground">
                        {quality}
                      </span>
                    </p>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </fieldset>
  )
}
