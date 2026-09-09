export default {
  build: {
    content: ['src/templates/**/*.html'],
    output: {
      path: 'output',
      from: ['src/templates'],
    },
  },
}
