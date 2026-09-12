# ACCA Generator 4

Base React + Vite para el generador de ACCAs, con autenticación Supabase.

## Instalación

```bash
npm install
cp .env.example .env
npm run dev
```

Configura en `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Nunca pongas una `service_role` key en el frontend.

## Autenticación incluida

- Registro por correo/contraseña
- Inicio de sesión
- Persistencia y auto-refresh de sesión
- Logout
- Recuperación de contraseña
- Escucha de cambios de sesión
- Manejo básico de errores

## Próxima integración

El dashboard queda preparado para incorporar el motor ACCA, fuentes de datos, mercados, cuotas, filtros y posteriormente RLS/tablas de Supabase.
