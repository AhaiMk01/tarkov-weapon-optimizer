# Optimizador de configuraciones de armas de Tarkov (versión web)

[Inglés](README.md) | [中文](README_ZH.md) | [Español](README_ES.md)

Un optimizador de configuraciones de armas del lado del cliente para Escape from Tarkov. Se ejecuta por completo en tu navegador, usando WebAssembly y el solucionador HiGHS para encontrar el conjunto de modificaciones matemáticamente óptimo de un arma según tus prioridades y restricciones.

No hay servidor backend. Todo, incluida la parte más pesada del cálculo, se ejecuta localmente a través de WASM.

![Project Overview](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![React](https://img.shields.io/badge/React-19%2B-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)
![Vite](https://img.shields.io/badge/Vite-6%2B-purple.svg)
![WASM](https://img.shields.io/badge/WASM-Powered-orange.svg)

## Características

Como el solucionador corre en el navegador, no hay latencia de servidor. Usa HiGHS, un solucionador de programación lineal compilado a WebAssembly, y equilibra ergonomía, retroceso y precio según los pesos que elijas.

La relajación de programación lineal devuelve valores fraccionarios, así que un paso de redondeo voraz los convierte en una configuración válida, libre de conflictos y óptima en enteros.

Cuando una sola cifra no basta para decidir, la vista de la frontera de Pareto dibuja la curva de compensación (por ejemplo, ergonomía frente a retroceso) para que veas cuánto cuesta cada opción.

Restricciones fijas que puedes establecer:

- Límite de presupuesto (₽)
- Ergonomía mínima
- Retroceso vertical máximo
- Capacidad mínima de cargador
- Rango mínimo de visualización
- Peso máximo (kg)

La disponibilidad se filtra por tu nivel de PMC y por la lealtad con cada comerciante, y puedes desactivar el Mercado Pulga.

La interfaz está localizada en 16 idiomas, incluidos English, Русский, 中文 y Español.

## Tecnologías utilizadas

- Frontend: [React](https://react.dev/), [Vite](https://vitejs.dev/), [TypeScript](https://www.typescriptlang.org/)
- UI: [Ant Design](https://ant.design/) v6
- Solucionador: [HiGHS](https://highs.dev/) vía WebAssembly, con relajación de programación lineal, luego perturbación y luego redondeo voraz
- Datos: [API JSON de Tarkov.dev](https://json.tarkov.dev/endpoints)

## Instalación y ejecución

Necesitas [Node.js](https://nodejs.org/) v18 o superior y [npm](https://www.npmjs.com/), que suele venir incluido.

1. Clona el repositorio:
   ```bash
   git clone https://github.com/AhaiMk01/tarkov-weapon-optimizer.git
   cd tarkov-weapon-optimizer
   ```

2. Entra en el directorio del frontend:
   ```bash
   cd frontend
   ```

3. Instala las dependencias:
   ```bash
   npm install
   ```
   Esto también verifica que el paquete WASM `highs` quedó instalado correctamente.

4. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```

5. Abre `http://localhost:5173`, o la URL que muestre la terminal.

## Implementación con Docker (autoalojamiento)

Cada etiqueta de lanzamiento publica imágenes preconstruidas de múltiples arquitecturas (`linux/amd64`, `linux/arm64`) en el Registro de Contenedores de GitHub, así que funcionan en servidores domésticos, VPS y Raspberry Pi.

El contenedor es solo un servidor web estático (`nginx:alpine`, unos 30 MB). Toda la optimización ocurre del lado del cliente, en el navegador de quien visita la página, así que no necesitas un backend, una base de datos ni variables de entorno.

### Inicio rápido (imagen preconstruida)

```bash
docker run -d \
  --name tarkov-optimizer \
  --restart unless-stopped \
  -p 8080:80 \
  ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
```

Luego abre `http://<your-host>:8080`.

Puedes cambiar `8080` por cualquier puerto del host; el contenedor siempre escucha en el `80` internamente. Para fijar una versión, reemplaza `:latest` por algo como `:2.4.2`.

### Compilar desde el código fuente

Si prefieres construir la imagen tú mismo, por ejemplo desde un fork:

```bash
cd frontend
docker build -t tarkov-optimizer .
docker run --rm -d -p 8080:80 --name tarkov-optimizer tarkov-optimizer
```

### Detrás de un proxy inverso

La aplicación es una SPA con un respaldo de rutas, de modo que cualquier URL enlazada en profundidad (por ejemplo `/explore`) devuelve `index.html`. Haz proxy del puerto del contenedor como con cualquier sitio estático. No usa WebSockets y no necesita sesiones persistentes.

### Detener o actualizar

```bash
docker stop tarkov-optimizer && docker rm tarkov-optimizer
docker pull ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
# luego vuelve a ejecutar el comando "Inicio rápido"
```

## Verificación y pruebas

El repositorio incluye un script de verificación que ejecuta el solucionador WASM con armas reales:

```bash
npx tsx test_multi_weapon_verification.ts
```

Optimiza armas de estructura compleja como la AK-74 y la M4A1, y comprueba que el resultado sea una configuración válida y óptima en enteros en lugar de un fallo.

## Contribuciones

Los pull requests son bienvenidos.

## Licencia

Este proyecto es para uso educativo y personal. Todos los datos provienen de [Tarkov.dev](https://tarkov.dev/).
