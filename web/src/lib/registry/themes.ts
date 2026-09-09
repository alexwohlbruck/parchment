export type Theme = {
  name: string
  label: string
  primary: { light: string; dark: string }
}

export const themes: Theme[] = [
  {
    name: 'parchment',
    label: 'Parchment',
    primary: { light: '35 8% 12%', dark: '40 8% 98%' },
  },
  {
    name: 'ink',
    label: 'Ink',
    primary: { light: '24 9.8% 10%', dark: '60 9.1% 97.8%' },
  },
  {
    name: 'compass',
    label: 'Compass',
    primary: { light: '0 72.2% 50.6%', dark: '0 72.2% 50.6%' },
  },
  {
    name: 'coral',
    label: 'Coral',
    primary: { light: '24.6 95% 53.1%', dark: '20.5 90.2% 48.2%' },
  },
  {
    name: 'amber',
    label: 'Amber',
    primary: { light: '37.7 92.1% 50.2%', dark: '43.3 96.4% 56.3%' },
  },
  {
    name: 'peach',
    label: 'Peach',
    primary: { light: '47.9 95.8% 53.1%', dark: '47.9 95.8% 53.1%' },
  },
  {
    name: 'citrine',
    label: 'Citrine',
    primary: { light: '47.9 95.8% 53.1%', dark: '47.9 95.8% 53.1%' },
  },
  {
    name: 'olive',
    label: 'Olive',
    primary: { light: '83.7 80.5% 44.3%', dark: '82.7 78% 55.5%' },
  },
  {
    name: 'forest',
    label: 'Forest',
    primary: { light: '158 38% 40%', dark: '158 50% 48%' },
  },
  {
    name: 'moss',
    label: 'Moss',
    primary: { light: '160.1 84.1% 39.4%', dark: '158.1 64.4% 51.6%' },
  },
  {
    name: 'teal',
    label: 'Teal',
    primary: { light: '172.5 66% 50.4%', dark: '172.5 66% 50.4%' },
  },
  {
    name: 'sky',
    label: 'Sky',
    primary: { light: '198.4 93.2% 59.6%', dark: '198.4 93.2% 59.6%' },
  },
  {
    name: 'cobalt',
    label: 'Cobalt',
    primary: { light: '221.2 83.2% 53.3%', dark: '217.2 91.2% 59.8%' },
  },
  {
    name: 'periwinkle',
    label: 'Periwinkle',
    primary: { light: '270.7 91% 65.1%', dark: '270 95.2% 75.3%' },
  },
  {
    name: 'indigo',
    label: 'Indigo',
    primary: { light: '239.4 83.5% 66.7%', dark: '234.5 89.5% 73.9%' },
  },
  {
    name: 'violet',
    label: 'Violet',
    primary: { light: '262.1 83.3% 57.8%', dark: '263.4 70% 50.4%' },
  },
  {
    name: 'iris',
    label: 'Iris',
    primary: { light: '292.2 84.1% 60.6%', dark: '292 91.4% 72.5%' },
  },
  {
    name: 'magenta',
    label: 'Magenta',
    primary: { light: '330.4 81.2% 60.4%', dark: '329.4 86.3% 70.2%' },
  },
]
