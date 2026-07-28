# Afinador de Piano v0.1

Aplicación web instalable (PWA) para detectar:

- nota musical;
- frecuencia en Hz;
- desviación en cents;
- frecuencia objetivo;
- estabilidad de la lectura;
- estado grave, afinada o aguda.

## Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub.
2. Sube todos los archivos y carpetas de este proyecto.
3. En GitHub, entra a **Settings > Pages**.
4. En **Build and deployment**, selecciona:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**
5. Guarda los cambios.
6. Abre la dirección que GitHub Pages mostrará.

El acceso al micrófono requiere HTTPS o localhost. GitHub Pages usa HTTPS.

## Probar localmente

No abras `index.html` directamente con doble clic si el navegador bloquea el micrófono.

Desde la carpeta del proyecto puedes usar:

```bash
python -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

## Recomendaciones de uso

- Acerca el dispositivo al piano.
- Toca una sola tecla.
- Mantén el sonido algunos segundos.
- Evita ruido ambiental.
- En notas con dos o tres cuerdas, la lectura puede fluctuar si las cuerdas están desajustadas entre sí.

## Alcance de la versión 0.1

Esta versión no calcula todavía una curva de afinación estirada ni la inarmonicidad particular del piano. Es una base funcional para validar la captura de audio y la detección de frecuencia en teléfonos y computadores.
