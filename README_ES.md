

# Optimizador de Configuraciones de Armas de Tarkov (Versión Web) 🔫

[Inglés](README.md) | [中文](README_ZH.md) | [Español](README_ES.md)

Un optimizador de configuraciones de armas avanzado y **del lado del cliente** para Escape from Tarkov. Esta herramienta se ejecuta completamente en tu navegador utilizando **WebAssembly (WASM)** y el **solucionador HiGHS** para encontrar el conjunto matemáticamente óptimo de modificaciones para cualquier arma, basándose en tus prioridades y restricciones.

> **No se requiere servidor backend**: Toda la lógica, incluida la compleja matemática de optimización, se ejecuta localmente en tu máquina a través de WASM.

![Project Overview](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![React](https://img.shields.io/badge/React-19%2B-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)
![Vite](https://img.shields.io/badge/Vite-6%2B-purple.svg)
![WASM](https://img.shields.io/badge/WASM-Powered-orange.svg)

## 🚀 Características principales

- **🚀 Optimización instantánea**: Se ejecuta directamente en tu navegador sin latencia del servidor.
- **🧠 Solucionador avanzado**: Utiliza el solucionador de programación lineal **HiGHS** compilado a WebAssembly para una optimización de grado industrial.
- **🎯 Buscador de configuraciones óptimas**: Equilibra **Ergonomía**, **Retroceso** y **Precio** según tus pesos personalizados.
- **📊 Exploración de la frontera de Pareto**: Visualiza la curva de compensación (p. ej., ergonomía frente a retroceso) para ayudarte a tomar decisiones informadas.
- **💡 Redondeo inteligente**: Implementa un algoritmo robusto de "Redondeo Voraz" para garantizar configuraciones válidas, libres de conflictos y óptimas en enteros a partir de la relajación fraccional de programación lineal.
- **🛡️ Restricciones fijas**:
    - Límite de presupuesto (₽)
    - Ergonomía mínima
    - Retroceso vertical máximo
    - Capacidad mínima de cargador
    - Rango mínimo de visualización
    - Peso máximo (kg)
- **🛒 Filtros inteligentes**:
    - Configuración de nivel de PMC y lealtad con comerciantes.
    - Activación/desactivación del Mercado Pulga.
- **🌍 Multilingüe**: Completamente localizado en 16 idiomas, incluidos **English**, **Русский**, **中文** y **Español**.

## 🛠️ Tecnologías utilizadas

- **Frontend**: [React](https://react.dev/) + [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Solucionador**: [HiGHS](https://highs.dev/) (vía WebAssembly)
    - *Estrategia*: Relajación de programación lineal + Perturbación + Redondeo voraz
- **Datos**: [API JSON de Tarkov.dev](https://json.tarkov.dev/endpoints)
- **UI**: [Ant Design](https://ant.design/) v6

## 📥 Instalación y ejecución

### Requisitos previos
- [Node.js](https://nodejs.org/) (v18 o superior)
- [npm](https://www.npmjs.com/) (generalmente se incluye con Node.js)

### Pasos

1. **Clonar el repositorio**:
   ```bash
   git clone https://github.com/AhaiMk01/tarkov-weapon-optimizer.git
   cd tarkov-weapon-optimizer
   ```

2. **Navegar al directorio del frontend**:
   ```bash
   cd frontend
   ```

3. **Instalar dependencias**:
   ```bash
   npm install
   ```
   *Nota: Esto verificará que el paquete WASM `highs` esté instalado correctamente.*

4. **Iniciar el servidor de desarrollo**:
   ```bash
   npm run dev
   ```

5. **Abrir en el navegador**:
   Visita `http://localhost:5173` (o la URL que se muestre en tu terminal).

## 🐳 Implementación con Docker (Autoalojamiento)

Las imágenes preconstruidas de múltiples arquitecturas (`linux/amd64`, `linux/arm64`) se publican en el Registro de Contenedores de GitHub con cada etiqueta de lanzamiento: adecuadas para servidores domésticos, VPS y Raspberry Pi.

> El contenedor es un servidor web estático puro (`nginx:alpine`, ~30 MB). Toda la optimización se ejecuta del lado del cliente en el navegador del visitante a través de WASM: sin servidor backend, sin base de datos, sin variables de entorno necesarias.

### Inicio rápido (Imagen preconstruida)

```bash
docker run -d \
  --name tarkov-optimizer \
  --restart unless-stopped \
  -p 8080:80 \
  ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
```

Luego abre `http://<your-host>:8080`.

Cambia `8080` por cualquier puerto del host; el contenedor siempre escucha en `80` internamente. Fija una versión específica reemplazando `:latest` por, por ejemplo, `:2.4.2`.

### Compilar desde el código fuente

Si prefieres compilar la imagen localmente (p. ej., desde un fork):

```bash
cd frontend
docker build -t tarkov-optimizer .
docker run --rm -d -p 8080:80 --name tarkov-optimizer tarkov-optimizer
```

### Detrás de un proxy inverso

La aplicación es una SPA (aplicación de una sola página) con un respaldo para SPA, por lo que cualquier URL enlazada en profundidad (p. ej., `/explore`) devuelve `index.html`. Haz proxy del puerto del contenedor como lo harías con cualquier sitio estático: no se necesitan WebSockets ni sesiones persistentes.

### Detener / Actualizar

```bash
docker stop tarkov-optimizer && docker rm tarkov-optimizer
docker pull ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
# luego vuelve a ejecutar el comando "Inicio rápido"
```

## 🧪 Verificación y pruebas

Este proyecto incluye un conjunto riguroso de verificación para garantizar la estabilidad y corrección del solucionador WASM.

- **Ejecutar script de verificación**:
  ```bash
  npx tsx test_multi_weapon_verification.ts
  ```
  Este script prueba el optimizador contra armas complejas del mundo real (p. ej., AK-74, M4A1) para garantizar que genera configuraciones válidas y óptimas en enteros sin errores.

## 🤝 Contribuciones

¡Las contribuciones son bienvenidas! No dudes en enviar un Pull Request.

## 📜 Licencia

Este proyecto es para uso educativo y personal. Todos los datos son proporcionados por [Tarkov.dev](https://tarkov.dev/).
