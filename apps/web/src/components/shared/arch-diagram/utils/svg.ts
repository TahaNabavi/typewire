import { H, VIEWBOX_HEIGHT, VIEWBOX_WIDTH, W } from '../constants'
import { NODES } from '../data/nodes'
import { NodeKey, SectionSpec, EdgeSpec, SplitEdgeSpec } from '../types'

export function svgX(percent: number) {
  return (percent / 100) * VIEWBOX_WIDTH
}

export function svgY(percent: number) {
  return (percent / 100) * VIEWBOX_HEIGHT
}

export function getNodePosition(key: NodeKey) {
  const node = NODES[key]

  return {
    ...node,

    x: svgX(node.x),
    y: svgY(node.y),

    width: node.width ?? W,
    height: node.height ?? H,
    radius: node.radius ?? 8,
  }
}

export function getSectionBounds(section: SectionSpec) {
  const [startX, startY] = section.start
  const [endX, endY] = section.end

  return {
    x: svgX(Math.min(startX, endX)),
    y: svgY(Math.min(startY, endY)),
    width: svgX(Math.abs(endX - startX)),
    height: svgY(Math.abs(endY - startY)),
  }
}

export function getSectionForNode(key: NodeKey) {
  return NODES[key].section
}

export function pathFor(from: NodeKey, to: NodeKey): string {
  const a = getNodePosition(from)
  const b = getNodePosition(to)

  const dx = b.x - a.x
  const dy = b.y - a.y

  const fromDown = dy >= 0

  const startY = fromDown ? a.y + H : a.y
  const endY = fromDown ? b.y : b.y + H

  const startX = a.x
  const endX = b.x

  if (Math.abs(dx) < 1) {
    return `
      M ${startX} ${startY}
      L ${endX} ${endY}
    `
  }

  if (Math.abs(dy) < 1) {
    const right = dx > 0

    const x1 = a.x + (right ? W / 2 : -W / 2)
    const x2 = b.x + (right ? -W / 2 : W / 2)

    return `
      M ${x1} ${a.y + H / 2}
      L ${x2} ${b.y + H / 2}
    `
  }

  if (Math.abs(dy) >= Math.abs(dx)) {
    const midY = startY + (endY - startY) * 0.5

    return `
      M ${startX} ${startY}
      L ${startX} ${midY}
      L ${endX} ${midY}
      L ${endX} ${endY}
    `
  }

  const midX = startX + (endX - startX) * 0.5

  const startSide = dx > 0 ? W / 2 : -W / 2
  const endSide = dx > 0 ? -W / 2 : W / 2

  return `
    M ${a.x + startSide} ${a.y + H / 2}
    L ${midX} ${a.y + H / 2}
    L ${midX} ${b.y + H / 2}
    L ${b.x + endSide} ${b.y + H / 2}
  `
}

export function splitPathFor(from: NodeKey, targets: NodeKey[]) {
  const source = getNodePosition(from)
  const targetNodes = targets.map(getNodePosition)

  const startX = source.x
  const startY = source.y + H

  const targetY = Math.min(...targetNodes.map((node) => node.y))

  const minX = Math.min(...targetNodes.map((node) => node.x))
  const maxX = Math.max(...targetNodes.map((node) => node.x))

  const junctionX = (minX + maxX) / 2

  const junctionY = startY + (targetY - startY) * 0.5

  const trunk = `
    M ${startX} ${startY}
    L ${startX} ${junctionY}
    L ${junctionX} ${junctionY}
  `

  const branches = targetNodes.map((target) => {
    return `
      M ${junctionX} ${junctionY}
      L ${target.x} ${junctionY}
      L ${target.x} ${targetY}
    `
  })

  return {
    trunk,
    branches,
    junction: {
      x: junctionX,
      y: junctionY,
    },
  }
}
export function edgeBelongsToSection(e: EdgeSpec, sectionId: string) {
  return (
    getSectionForNode(e.from) === sectionId ||
    getSectionForNode(e.to) === sectionId
  )
}

export function splitEdgeBelongsToSection(e: SplitEdgeSpec, sectionId: string) {
  return (
    getSectionForNode(e.from) === sectionId ||
    e.to.some((node) => getSectionForNode(node) === sectionId)
  )
}
