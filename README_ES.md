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

### Motor de optimización matemática
- **Solucionador multiobjetivo**: Equilibra ergonomía, retroceso vertical y precio mediante [HiGHS](https://highs.dev/) (solucionador de programación lineal entera mixta de alto rendimiento compilado en WebAssembly) ejecutándose en Web Workers dedicados.
- **Modo Sweet Spot (Escalarización de Tchebycheff aumentada)**: Resuelve configuraciones de Pareto no convexas equilibradas respecto al punto ideal 3D del arma ($z^*_E, z^*_R, z^*_P$). Descubre configuraciones óptimas en hendiduras no convexas que las sumas lineales ponderadas omiten matemáticamente.
- **Modo EvoErgo (Ergonomía ajustada al peso)**: Optimiza la ergonomía ajustada al peso y la métrica cuadrática real EvoErgoDelta ($\text{EED} = (100 - 0.015 \cdot (100 - E)^2) - 15 \cdot W$) mediante un solucionador de barrido de tangentes $k$, reflejando la velocidad real de apuntado (ADS) y la física de sobreoscilación del juego.
- **Resolución de conflictos y factibilidad**: Resuelve árboles de modificaciones complejos, exclusiones mutuas, requisitos de ranura principal y dependencias múltiples usando relajación LP, perturbación y redondeo entero voraz.

### Restricciones fijas y control de modificaciones
- **Restricción de prevención de sobreoscilación (Prevent Overswing)**: Aplica $W \le \text{Threshold}(E_{\text{eff}}) \iff \text{EED} \ge 0$ mediante planos de corte tangentes exactos, garantizando cero sobreoscilación de la mira al apuntar.
- **Penalización de ergonomía de equipo ($b$)**: Configura una penalización de $-40\%$ a $0\%$ para modelar el impacto de armaduras, cascos y mochilas equipadas.
- **Límites de estadísticas**: Fija límites estrictos de retroceso vertical máximo, ergonomía mínima, peso máximo (kg) y presupuesto (₽).
- **Balística y límites de dispersión (MOA)**: Fija la dispersión máxima (MOA) utilizando las fórmulas reales del juego de BSG ($K \approx 34.3$) y las reglas de reemplazo de cañones.
- **Requisitos funcionales**: Exige capacidad mínima de cargador, alcance mínimo de mira y calibres específicos.
- **Filtros de comerciantes y Mercado Pulga**: Filtra piezas por nivel de PMC, nivel de lealtad de comerciantes (LL1–LL4) y activa o desactiva el Mercado Pulga.
- **Retención de preajustes y bloqueo de piezas**: Conserva las piezas del preajuste base con un solo clic, bloquea componentes preferidos (por ejemplo, tu mira o silenciador favorito) o excluye piezas no deseadas.

### Análisis, exploración y experiencia de usuario
- **Exploración de Pareto 2D acelerada con AUGMECON2**: Exploración rápida mediante $\epsilon$-restricciones aumentadas con omisión de holgura en curvas de Ergonomía vs. Retroceso, Ergonomía vs. Precio y Retroceso vs. Precio.
- **Métricas EED y EvoErgo en tiempo real**: Tarjetas con código de color (+verde / -rojo) que ofrecen retroalimentación instantánea sobre la sobreoscilación y la eficiencia de peso.
- **Guía interactiva y modal de metodología**: Documentación matemática integrada con renderizado KaTeX para la física de armas de Tarkov, fórmulas de retroceso y algoritmos del solucionador.
- **100% del lado del cliente y listo para usar sin conexión**: Cero latencia de servidor y sin rastreo; todos los cálculos se realizan localmente en el navegador.
- **16 idiomas disponibles**: cs, de, en, es, fr, hu, it, ja, ko, pl, pt, ro, ru, sk, tr, zh.

## Tecnologías utilizadas

- **Frontend**: [React](https://react.dev/) 19, [Vite](https://vitejs.dev/) 6, [TypeScript](https://www.typescriptlang.org/)
- **UI y visualización**: [Ant Design](https://ant.design/) v6, [Recharts](https://recharts.org/), [KaTeX](https://katex.org/)
- **Solucionador de optimización**: [HiGHS](https://highs.dev/) vía WebAssembly (MILP / Relajación LP / Tchebycheff aumentado / AUGMECON2 / Planos de corte)
- **Fuente de datos**: [API JSON de Tarkov.dev](https://json.tarkov.dev/endpoints)
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
