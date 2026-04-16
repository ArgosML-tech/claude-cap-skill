Cómo replicarlo en cualquier proyecto nuevo
Cuando tengas un nuevo proyecto CAP, solo tienes que:


# 1. Clonar el repositorio
git clone https://github.com/ArgosML-tech/claude-cap-skill.git mi-proyecto-cap
cd mi-proyecto-cap

# 2. Instalar dependencias (solo Playwright)
npm install
npm run install:playwright   # descarga Chromium headless (~150MB, solo una vez)

# 3. Abrir Claude Code desde esta carpeta
claude
# → Claude lee CLAUDE.md automáticamente y ya sabe cómo construir la app
