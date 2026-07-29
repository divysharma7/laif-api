import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { config } from '../config.js'

let prisma: PrismaClient | undefined

export function getPrisma(): PrismaClient {
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for PostgreSQL persistence')
  }

  if (!prisma) {
    const adapter = new PrismaPg({ connectionString: config.DATABASE_URL })
    prisma = new PrismaClient({ adapter })
  }

  return prisma
}

export async function disconnectPrisma(): Promise<void> {
  if (!prisma) return
  await prisma.$disconnect()
  prisma = undefined
}
