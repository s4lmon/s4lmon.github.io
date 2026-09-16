build:
    npm run build

# Build, open the browser, serve dist/
serve: build
    (sleep 1 && xdg-open http://localhost:3000) & npx serve -n dist

test:
    npm test

# Typecheck and formatting
check:
    npm run check

format:
    npm run format
