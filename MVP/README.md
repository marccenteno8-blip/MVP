# Chic Estilistes — plataforma de reservas

Web de reservas conectada a Supabase: calcula el primer hueco libre de cada
estilista en tiempo real y lo comparte entre la web, el simulador de
WhatsApp y el panel del salón (que se actualiza solo vía Supabase Realtime).

Los datos de estilistas, servicios, horario y precios son de ejemplo
(`supabase/migrations/0001_init.sql`) — se sustituyen por los reales de
Chic Estilistes en cuanto tengas acceso a ellos.

## 1. Requisitos

- Node.js 18 o superior
- Una cuenta de [GitHub](https://github.com)
- Una cuenta de [Supabase](https://supabase.com) (plan gratuito es suficiente)
- Una cuenta de [Vercel](https://vercel.com) (plan gratuito es suficiente)

## 2. Subir el código a GitHub

```bash
cd chic-estilistes-platform
git init
git add .
git commit -m "Plataforma de reservas — versión inicial"
```

Crea un repositorio nuevo en GitHub (puede ser privado) y sigue las
instrucciones que te da para conectar tu carpeta local:

```bash
git remote add origin https://github.com/TU-USUARIO/chic-estilistes-platform.git
git branch -M main
git push -u origin main
```

## 3. Crear el proyecto en Supabase

1. Entra en [supabase.com](https://supabase.com) → **New project**.
2. Cuando esté listo, ve a **SQL Editor** → **New query**.
3. Copia y pega todo el contenido de `supabase/migrations/0001_init.sql`
   y pulsa **Run**. Esto crea las tablas, los permisos (RLS), la función
   `next_available_slot` y los datos de ejemplo.
4. Ve a **Project Settings → API** y copia:
   - **Project URL**
   - **anon public key**

## 4. Configurar las variables de entorno

```bash
cp .env.example .env
```

Pega en `.env` la URL y la clave que has copiado en el paso anterior:

```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-clave-anon
```

## 5. Probar en local

```bash
npm install
npm run dev
```

Abre `http://localhost:5173` — deberías ver los tres estilistas de ejemplo
y poder reservar, simular WhatsApp y ver el panel actualizarse en directo.

## 6. Desplegar en Vercel

1. Entra en [vercel.com](https://vercel.com) → **Add New → Project**.
2. Importa el repositorio de GitHub que acabas de crear.
3. En **Environment Variables**, añade las mismas dos variables del `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Pulsa **Deploy**. En un par de minutos tendrás una URL pública
   (algo como `chic-estilistes-platform.vercel.app`) lista para enviar
   al cliente.

A partir de aquí, cada `git push` a `main` despliega automáticamente la
nueva versión, y cada Pull Request genera su propia URL de vista previa
para enseñar cambios antes de publicarlos.

## 7. WhatsApp real (opcional, siguiente paso)

`supabase/functions/whatsapp-webhook` contiene el esqueleto de la función
que recibiría los mensajes reales de WhatsApp Business y reutiliza la
misma `next_available_slot` que usa la web. Para activarla:

```bash
supabase functions deploy whatsapp-webhook
supabase secrets set WHATSAPP_VERIFY_TOKEN=elige-un-token
supabase secrets set WHATSAPP_ACCESS_TOKEN=token-de-meta
supabase secrets set WHATSAPP_PHONE_ID=id-del-numero
```

Y apunta el webhook de tu app de Meta a la URL que te da
`supabase functions deploy`.

## 8. Antes de pasar a producción

El esquema actual está pensado para que la demo funcione de extremo a
extremo sin necesidad de login. Antes de lanzarlo con datos reales de
clientas conviene:

- Añadir Supabase Auth para el panel del salón, y restringir en las
  políticas RLS quién puede ver `customer_name` en `bookings`.
- Añadir la restricción de exclusión comentada al final de
  `0001_init.sql` para evitar dobles reservas simultáneas.
- Revisar el horario real y sustituir los estilistas y servicios de
  ejemplo por los del salón.
