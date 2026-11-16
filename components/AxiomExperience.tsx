'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/dist/ScrollTrigger'

const IndustrialScene = dynamic(() => import('./IndustrialScene'), {
  ssr: false,
  loading: () => <div className="spatial-loading"><i />ЗАГРУЖАЕМ 3D-СЦЕНУ</div>,
})

const STAGES = [
  { at: 0, code: '00', label: '3D В БРАУЗЕРЕ' },
  { at: 1 / 7, code: '01', label: 'КОМПОЗИЦИЯ' },
  { at: 2 / 7, code: '02', label: 'ДЕТАЛИ' },
  { at: 3 / 7, code: '03', label: 'МАТЕРИАЛЫ' },
  { at: .625, code: '04', label: 'ДВИЖЕНИЕ КАМЕРЫ' },
  { at: 5 / 7, code: '05', label: 'АНИМАЦИЯ' },
  { at: 6 / 7, code: '06', label: 'СХЕМА' },
  { at: .97, code: '07', label: 'ПРОЕКТ' },
] as const

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const ramp = (value: number, from: number, to: number) => clamp((value - from) / Math.max(to - from, .0001))
const ease = (value: number) => value * value * (3 - 2 * value)
const windowOpacity = (progress: number, enter: number, full: number, leave: number, gone: number) => (
  ease(ramp(progress, enter, full)) * (1 - ease(ramp(progress, leave, gone)))
)

function Arrow() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 9h13M10 4l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
}

function SpatialWorld({ progress, progressRef }: { progress: number; progressRef: React.MutableRefObject<number> }) {
  const sceneActive = progress < .999
  return (
    <div className="spatial-world" aria-hidden="true">
      <div className={sceneActive ? 'world-canvas' : 'world-canvas is-paused'}>
        <IndustrialScene progressRef={progressRef} active={sceneActive} />
      </div>
      <div className="terminal-grade" />
      <div className="spatial-grid" />
      <div className="analysis-wash" />
    </div>
  )
}

function SceneCaption({ title, opacity, children }: {
  title: string
  opacity: number
  children?: React.ReactNode
}) {
  return (
    <div className="scene-caption" style={{ opacity, visibility: opacity < .01 ? 'hidden' : 'visible' }} aria-hidden={opacity < .05}>
      <h2>{title}</h2>
      {children}
    </div>
  )
}

function TerminalMoment({ progress, ready, onStart }: { progress: number; ready: boolean; onStart: () => void }) {
  const opacity = ready ? windowOpacity(progress, -.02, -.001, .08, .12) : 0
  return (
    <div className="scene-caption scene-caption--hero" style={{ opacity }} aria-hidden={opacity < .05}>
      <h1>Промышленный<br /><em>пейзаж.</em></h1>
      <button className="scene-caption-button" type="button" onClick={onStart} tabIndex={opacity > .7 ? 0 : -1}>Смотреть проект<Arrow /></button>
    </div>
  )
}

function TwinMoment({ progress }: { progress: number }) {
  return <SceneCaption title="Собираем окружение." opacity={windowOpacity(progress, .12, .142, .235, .265)} />
}

function ProcessMoment({ progress }: { progress: number }) {
  return <SceneCaption title="Подходим ближе." opacity={windowOpacity(progress, .265, .285, .385, .405)} />
}

function StorageMoment({ progress }: { progress: number }) {
  return <SceneCaption title="Настраиваем свет." opacity={windowOpacity(progress, .405, .425, .49, .53)} />
}

function PipeEntryTransition() {
  return <div className="pipe-entry-occlusion" aria-hidden="true" />
}

function FlowField({ progress }: { progress: number }) {
  return <SceneCaption title="Меняем точку зрения." opacity={windowOpacity(progress, .60, .625, .68, .705)} />
}

function AIField({ progress }: { progress: number }) {
  return <SceneCaption title="Оживляем механику." opacity={windowOpacity(progress, .705, 5 / 7, .78, .805)} />
}

function NetworkField({ progress }: { progress: number }) {
  return <SceneCaption title="Показываем связи." opacity={windowOpacity(progress, .835, .86, .925, .94)} />
}

function OSField({ progress, onRestart }: { progress: number; onRestart: () => void }) {
  const opacity = ease(ramp(progress, .94, .972))
  return (
    <SceneCaption title="3D. В браузере." opacity={opacity}>
      <button className="scene-caption-button" type="button" onClick={onRestart} tabIndex={opacity > .7 ? 0 : -1}>Посмотреть ещё раз<Arrow /></button>
    </SceneCaption>
  )
}

export default function AxiomExperience() {
  const experienceRef = useRef<HTMLElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef(0)
  const targetProgress = useRef(0)
  const navigationTarget = useRef<number | null>(null)
  const scrollTween = useRef<gsap.core.Tween | null>(null)
  const updateFrame = useRef<number | null>(null)
  const lastUiUpdate = useRef(0)
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setReducedMotion(reduced)
    const timer = window.setTimeout(() => setReady(true), reduced ? 0 : 1350)
    return () => window.clearTimeout(timer)
  }, [])

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const element = experienceRef.current
    const shell = shellRef.current
    if (!element || !shell) return

    const context = gsap.context(() => {
      const trigger = ScrollTrigger.create({
        trigger: element,
        start: 'top top',
        end: 'bottom bottom',
        onUpdate: (self) => { targetProgress.current = clamp(self.progress) },
      })
      const renderProgress = (_time: number, deltaMs: number) => {
          const previous = progressRef.current
          const distance = targetProgress.current - previous
          const next = reducedMotion || Math.abs(distance) < .00001
            ? targetProgress.current
            : previous + distance * (1 - Math.exp(-10 * Math.min(deltaMs, 64) / 1000))
          if (next === previous) return
          progressRef.current = next
          document.documentElement.style.setProperty('--progress', next.toFixed(4))
          shell.style.setProperty('--digital-opacity', windowOpacity(next, .095, .145, .47, .55).toFixed(4))
          shell.style.setProperty('--analysis-wash', ease(ramp(next, .44, .58)).toFixed(4))
          shell.style.setProperty('--storage-opacity', windowOpacity(next, .385, .425, .51, .545).toFixed(4))
          shell.style.setProperty('--flow-opacity', windowOpacity(next, .56, .59, .68, .715).toFixed(4))
          shell.style.setProperty('--ai-opacity', windowOpacity(next, .695, .725, .78, .805).toFixed(4))
          shell.style.setProperty('--entry-cover', windowOpacity(next, .49, .53, .59, .615).toFixed(4))
          shell.style.setProperty('--entry-scale', (1 + ease(ramp(next, .49, .59)) * 1.8).toFixed(4))
          const now = window.performance.now()
          if (now - lastUiUpdate.current < 40 && next > .001 && next < .999) return
          lastUiUpdate.current = now
          if (updateFrame.current) cancelAnimationFrame(updateFrame.current)
          updateFrame.current = requestAnimationFrame(() => setProgress(next))
      }
      gsap.ticker.add(renderProgress)
      return () => { trigger.kill(); gsap.ticker.remove(renderProgress) }
    }, element)

    const onPointerMove = (event: PointerEvent) => {
      shell.style.setProperty('--mx', `${(event.clientX / window.innerWidth - .5) * -8}px`)
      shell.style.setProperty('--my', `${(event.clientY / window.innerHeight - .5) * -5}px`)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    requestAnimationFrame(() => ScrollTrigger.refresh())

    return () => {
      if (updateFrame.current) cancelAnimationFrame(updateFrame.current)
      window.removeEventListener('pointermove', onPointerMove)
      context.revert()
    }
  }, [reducedMotion])


  const stage = useMemo(() => [...STAGES].reverse().find((item) => progress >= item.at - .02) ?? STAGES[0], [progress])
  const jumpTo = useCallback((at: number) => {
    const element = experienceRef.current
    if (!element) return
    const top = window.scrollY + element.getBoundingClientRect().top
    const target = top + at * (element.offsetHeight - window.innerHeight)
    scrollTween.current?.kill()
    navigationTarget.current = at
    if (reducedMotion) {
      window.scrollTo({ top: target, behavior: 'instant' })
      navigationTarget.current = null
      return
    }
    const position = { y: window.scrollY }
    scrollTween.current = gsap.to(position, {
      y: target,
      duration: Math.abs(at - progressRef.current) > .15 ? 2.8 : 2.1,
      ease: 'sine.inOut',
      onUpdate: () => window.scrollTo({ top: position.y, behavior: 'instant' }),
      onComplete: () => { scrollTween.current = null; navigationTarget.current = null },
    })
  }, [reducedMotion])

  useEffect(() => {
    const interrupt = () => {
      scrollTween.current?.kill()
      scrollTween.current = null
      navigationTarget.current = null
    }
    window.addEventListener('wheel', interrupt, { passive: true })
    window.addEventListener('touchstart', interrupt, { passive: true })
    return () => {
      interrupt()
      window.removeEventListener('wheel', interrupt)
      window.removeEventListener('touchstart', interrupt)
    }
  }, [])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!['ArrowRight', 'ArrowLeft'].includes(event.key)) return
      const target = event.target
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="slider"]'))) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      let index = 0
      const current = navigationTarget.current ?? progressRef.current
      STAGES.forEach((item, itemIndex) => { if (current >= item.at - .02) index = itemIndex })
      jumpTo(STAGES[clamp(index + (event.key === 'ArrowRight' ? 1 : -1), 0, STAGES.length - 1)].at)
    }
    window.addEventListener('keydown', keydown, { capture: true })
    return () => window.removeEventListener('keydown', keydown, { capture: true })
  }, [jumpTo])

  return (
    <main className="industrial-experience">
      <a className="skip-link" href="#experience">Перейти к проекту</a>
      <section className="experience" ref={experienceRef} aria-label="AXIOM - интерактивный проект с 3D-графикой">
        <div className="experience-shell" id="experience" ref={shellRef} tabIndex={-1}>
          <SpatialWorld progress={progress} progressRef={progressRef} />
          <PipeEntryTransition />
          {progress > .525 && progress < .73 ? <FlowField progress={progress} /> : null}
          {progress > .685 && progress < .855 ? <AIField progress={progress} /> : null}
          {progress > .82 && progress < .96 ? <NetworkField progress={progress} /> : null}
          {progress > .925 ? <OSField progress={progress} onRestart={() => jumpTo(0)} /> : null}
          <div className="grain" aria-hidden="true" />
          {progress < .17 ? <TerminalMoment progress={progress} ready={ready} onStart={() => jumpTo(STAGES[1].at)} /> : null}
          {progress > .07 && progress < .32 ? <TwinMoment progress={progress} /> : null}
          {progress > .22 && progress < .46 ? <ProcessMoment progress={progress} /> : null}
          {progress > .36 && progress < .56 ? <StorageMoment progress={progress} /> : null}
          <p className="sr-only" aria-live="polite">Глава {stage.code}: {stage.label}</p>
        </div>
        <div className="scroll-space" aria-hidden="true">{STAGES.map((item) => <i key={item.code} />)}</div>
      </section>
    </main>
  )
}
