"use client"

import { useState, useTransition, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Check, X } from "lucide-react"

export function GroupName({ id, name, url }: { id: string; name: string; url: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const save = () => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === name) {
      setValue(name)
      setEditing(false)
      return
    }
    startTransition(async () => {
      const res = await fetch("/api/groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: trimmed }),
      })
      if (res.ok) {
        setEditing(false)
        router.refresh()
      } else {
        alert("Failed to rename group")
      }
    })
  }

  const cancel = () => {
    setValue(name)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save()
            if (e.key === "Escape") cancel()
          }}
          disabled={isPending}
          className="h-7 min-w-0 flex-1 rounded-md border border-brand bg-background px-1.5 text-sm outline-none ring-2 ring-brand/30"
        />
        <button
          onClick={save}
          disabled={isPending}
          aria-label="Save name"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={cancel}
          disabled={isPending}
          aria-label="Cancel"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="group/name flex min-w-0 items-center gap-1.5">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="truncate text-sm font-medium hover:text-brand hover:underline"
      >
        {name}
      </a>
      <button
        onClick={() => setEditing(true)}
        aria-label="Rename group"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/name:opacity-100"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  )
}
