module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EAF6FF',
          100: '#D3ECFF',
          300: '#7ED1FF',
          500: '#32B5FE',
          700: '#1E86C2',
        },
        primary: '#1B3A57',
        secondary: '#31506D',
        accent: '#32B5FE',
        surface: '#F7FAFC',
        muted: '#5C6673',
        soft: '#BFD7F5',
        hero: '#061B2E',
        'hero-overlay': '#081827',
        'ink-strong': '#212832',
        ink: '#1B3A57',
      },
      spacing: {
        'section-x': '1.5rem',
        'section-y': '3rem',
      },
      boxShadow: {
        card: '0 20px 60px rgba(27,58,87,0.08)',
      },
    },
  },
  plugins: [],
};
