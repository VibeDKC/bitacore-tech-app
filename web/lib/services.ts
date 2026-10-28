import {
  Archive,
  Bug,
  Code2,
  Copy,
  Cpu,
  Database,
  Download,
  Headphones,
  KeyRound,
  Laptop,
  Mail,
  MessagesSquare,
  Package,
  Printer,
  Stethoscope,
  Wifi,
  Wrench,
  type LucideIcon
} from 'lucide-react'

export type ServiceItem = {
  title: string
  description: string
  icon: LucideIcon
  comingSoon?: boolean
}

export type ServiceGroup = {
  title: string
  description: string
  items: ServiceItem[]
}

export const serviceGroups: ServiceGroup[] = [
  {
    title: 'Diagnóstico y revisión',
    description:
      'El punto de partida para cualquier reparación. Revisamos el equipo y preparamos la cotización.',
    items: [
      {
        title: 'Revisión inicial y diagnóstico',
        description:
          'Evaluamos el estado del equipo, identificamos la falla y entregamos una cotización. El valor se confirma según el caso.',
        icon: Stethoscope
      }
    ]
  },
  {
    title: 'Reparación y mantenimiento',
    description:
      'Soluciones para equipos de cómputo, impresoras y accesorios que necesitan volver a funcionar.',
    items: [
      {
        title: 'Reparación de equipos',
        description:
          'Diagnóstico y reparación de laptops, PCs, impresoras y equipos de oficina.',
        icon: Wrench
      },
      {
        title: 'Mantenimiento de equipos e impresoras',
        description:
          'Mantenimiento preventivo y correctivo para prolongar la vida útil del equipo.',
        icon: Printer
      },
      {
        title: 'Recuperación de acceso a equipos',
        description:
          'Apoyo para recuperar el acceso a un equipo, siempre con autorización del cliente.',
        icon: KeyRound
      }
    ]
  },
  {
    title: 'Software y sistema operativo',
    description:
      'Instalación, configuración y optimización del sistema y las aplicaciones.',
    items: [
      {
        title: 'Instalación y configuración de sistema operativo',
        description:
          'Instalación limpia, actualizaciones y configuración inicial de Windows o Linux.',
        icon: Laptop
      },
      {
        title: 'Instalación de drivers',
        description:
          'Configuración de los controladores necesarios para el correcto funcionamiento del equipo.',
        icon: Download
      },
      {
        title: 'Instalación de programas',
        description:
          'Instalación y configuración de las aplicaciones que necesitas para trabajar o estudiar.',
        icon: Package
      },
      {
        title: 'Limpieza y eliminación de virus/malware',
        description:
          'Revisión, limpieza y optimización para mejorar el rendimiento y la seguridad.',
        icon: Bug
      },
      {
        title: 'Soporte remoto',
        description:
          'Acompañamiento para resolver problemas de software sin desplazarte.',
        icon: Headphones
      }
    ]
  },
  {
    title: 'Datos y respaldo',
    description:
      'Protegemos y migramos tu información con procedimientos cuidadosos.',
    items: [
      {
        title: 'Recuperación de datos',
        description:
          'Intentamos recuperar archivos de discos, memorias o equipos con fallas.',
        icon: Database
      },
      {
        title: 'Respaldo de información',
        description:
          'Copias de seguridad locales o en la nube para proteger tus archivos importantes.',
        icon: Archive
      },
      {
        title: 'Clonación y migración de datos',
        description:
          'Pasamos tu información y configuración a un equipo nuevo o a un disco SSD.',
        icon: Copy
      }
    ]
  },
  {
    title: 'Equipos, componentes y redes',
    description:
      'Mejoras de hardware y configuración de la red de tu hogar u oficina.',
    items: [
      {
        title: 'Instalación de componentes y ampliaciones',
        description:
          'Instalación de RAM, SSD, tarjetas y ensamble de equipos.',
        icon: Cpu
      },
      {
        title: 'Configuración de redes Wi-Fi y cableadas',
        description:
          'Configuración de routers, repetidores, red local y equipos conectados.',
        icon: Wifi
      },
      {
        title: 'Configuración de correo y respaldo en la nube',
        description:
          'Configuración de cuentas de correo, servicios en la nube y respaldo automático.',
        icon: Mail
      }
    ]
  },
  {
    title: 'Asesorías',
    description:
      'Orientación para tomar mejores decisiones sobre tus equipos y tu información.',
    items: [
      {
        title: 'Asesoría técnica y compra de equipos',
        description:
          'Te ayudamos a elegir el equipo, los componentes o la solución que mejor se ajuste a tu necesidad.',
        icon: MessagesSquare
      }
    ]
  },
  {
    title: 'Próximamente',
    description:
      'Servicios que estamos preparando para complementar la atención del taller.',
    items: [
      {
        title: 'Diseño de aplicaciones básicas',
        description:
          'Aplicaciones sencillas para organizar procesos del negocio. Próximamente.',
        icon: Code2,
        comingSoon: true
      }
    ]
  }
]

export const serviceOptions = serviceGroups
  .flatMap((group) => group.items)
  .filter((item) => !item.comingSoon)
  .map((item) => item.title)

export const serviceCount = serviceOptions.length
