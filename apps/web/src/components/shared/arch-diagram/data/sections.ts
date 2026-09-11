import { SectionSpec } from '../types'

export const SECTIONS: SectionSpec[] = [
  {
    id: 'tooling',
    start: [1, 0],
    end: [99, 5.5],
    title: 'TOOLING',
    desc: 'Developer tooling',

    style: {
      background: 'color-mix(in oklab, var(--amber) 3%, var(--panel))',
      border: 'var(--amber)',
      borderWidth: 1,
      radius: 12,
      opacity: 0.45,

      hoverBackground: 'color-mix(in oklab, var(--amber) 9%, var(--panel))',
      hoverBorder: 'var(--amber)',
      hoverBorderWidth: 1.5,
      hoverOpacity: 1,

      padding: 10,

      titleColor: 'var(--amber)',
      hoverTitleColor: 'var(--amber)',

      descColor: 'var(--muted-foreground)',
      hoverDescColor: 'var(--foreground)',

      titleSize: 8,
      descSize: 6.5,
    },
  },

  {
    id: 'core',
    start: [1, 6],
    end: [99, 12],
    title: 'CORE',
    desc: 'Contracts, client and server',

    style: {
      background: 'color-mix(in oklab, var(--cyan) 2%, var(--panel))',
      border: 'var(--cyan)',
      borderWidth: 1,
      radius: 14,
      opacity: 0.4,

      hoverBackground: 'color-mix(in oklab, var(--cyan) 7%, var(--panel))',
      hoverBorder: 'var(--cyan)',
      hoverBorderWidth: 1.5,
      hoverOpacity: 1,

      padding: 12,

      titleColor: 'var(--cyan)',
      hoverTitleColor: 'var(--cyan)',

      descColor: 'var(--muted-foreground)',
      hoverDescColor: 'var(--foreground)',

      titleSize: 8,
      descSize: 6.5,
    },
  },

  {
    id: 'transport',
    start: [1, 20.5],
    end: [65.5, 36],
    title: 'TRANSPORT',
    desc: 'Network adapters',

    style: {
      background: 'color-mix(in oklab, var(--cyan) 2%, var(--panel))',
      border: 'var(--cyan)',
      borderWidth: 1,
      radius: 14,
      opacity: 0.4,

      hoverBackground: 'color-mix(in oklab, var(--cyan) 8%, var(--panel))',
      hoverBorder: 'var(--cyan)',
      hoverBorderWidth: 1.5,
      hoverOpacity: 1,

      padding: 12,

      titleColor: 'var(--cyan)',
      hoverTitleColor: 'var(--cyan)',

      descColor: 'var(--muted-foreground)',
      hoverDescColor: 'var(--foreground)',

      titleSize: 8,
      descSize: 6.5,
    },
  },

  {
    id: 'server',
    start: [66.5, 20.5],
    end: [99, 36],
    title: 'SERVER',
    desc: 'Server integrations',

    style: {
      background: 'color-mix(in oklab, var(--wire-ws) 2%, var(--panel))',
      border: 'var(--wire-ws)',
      borderWidth: 1,
      radius: 14,
      opacity: 0.4,

      hoverBackground: 'color-mix(in oklab, var(--wire-ws) 8%, var(--panel))',
      hoverBorder: 'var(--wire-ws)',
      hoverBorderWidth: 1.5,
      hoverOpacity: 1,

      padding: 10,

      titleColor: 'var(--wire-ws)',
      hoverTitleColor: 'var(--wire-ws)',

      descColor: 'var(--muted-foreground)',
      hoverDescColor: 'var(--foreground)',

      titleSize: 8,
      descSize: 6.5,
    },
  },

  {
    id: 'framework',
    start: [1, 41],
    end: [32.5, 61],
    title: 'FRAMEWORK',
    desc: 'Framework integrations',

    style: {
      background: 'color-mix(in oklab, var(--purple) 2%, var(--panel))',
      border: 'var(--purple)',
      borderWidth: 1,
      radius: 14,
      opacity: 0.4,

      hoverBackground: 'color-mix(in oklab, var(--purple) 8%, var(--panel))',
      hoverBorder: 'var(--purple)',
      hoverBorderWidth: 1.5,
      hoverOpacity: 1,

      padding: 10,

      titleColor: 'var(--purple)',
      hoverTitleColor: 'var(--purple)',

      descColor: 'var(--muted-foreground)',
      hoverDescColor: 'var(--foreground)',

      titleSize: 8,
      descSize: 6.5,
    },
  },

  {
    id: 'runtime',
    start: [33.5, 41],
    end: [65.5, 61],
    title: 'RUNTIME',
    desc: 'Runtime and developer tools',

    style: {
      background: 'color-mix(in oklab, var(--purple) 2%, var(--panel))',
      border: 'var(--purple)',
      borderWidth: 1,
      radius: 14,
      opacity: 0.4,

      hoverBackground: 'color-mix(in oklab, var(--purple) 8%, var(--panel))',
      hoverBorder: 'var(--purple)',
      hoverBorderWidth: 1.5,
      hoverOpacity: 1,

      padding: 10,

      titleColor: 'var(--purple)',
      hoverTitleColor: 'var(--purple)',

      descColor: 'var(--muted-foreground)',
      hoverDescColor: 'var(--foreground)',

      titleSize: 8,
      descSize: 6.5,
    },
  },

  {
    id: 'security',
    start: [66.5, 41],
    end: [99, 61],
    title: 'SECURITY',
    desc: 'Permissions and access',

    style: {
      background: 'color-mix(in oklab, var(--cyan) 2%, var(--panel))',
      border: 'var(--cyan)',
      borderWidth: 1,
      radius: 14,
      opacity: 0.4,

      hoverBackground: 'color-mix(in oklab, var(--cyan) 8%, var(--panel))',
      hoverBorder: 'var(--cyan)',
      hoverBorderWidth: 1.5,
      hoverOpacity: 1,

      padding: 10,

      titleColor: 'var(--cyan)',
      hoverTitleColor: 'var(--cyan)',

      descColor: 'var(--muted-foreground)',
      hoverDescColor: 'var(--foreground)',

      titleSize: 8,
      descSize: 6.5,
    },
  },
]
