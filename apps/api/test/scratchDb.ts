import { Client } from 'pg'

/**
 * Base vierge pour un test.
 *
 * Chaque test qui parle à Postgres reçoit sa propre base, créée à la
 * demande et détruite après lui : « migrations testées sur base vierge »
 * est littéral, et aucun test ne peut dépendre des résidus d'un autre.
 *
 * `WITH (FORCE)` au drop : le test peut laisser une connexion ouverte
 * (c'est même le sujet des tests de concurrence), et un drop poli
 * attendrait indéfiniment.
 */
let counter = 0

export interface ScratchDb {
  readonly url: string
  drop(): Promise<void>
}

export async function createScratchDb(adminUrl: string): Promise<ScratchDb> {
  const name = `scratch_${process.pid}_${counter++}`

  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()

  return {
    url: adminUrl.replace(/\/postgres(\?|$)/, `/${name}$1`),
    async drop() {
      const client = new Client({ connectionString: adminUrl })
      await client.connect()
      await client.query(`DROP DATABASE ${name} WITH (FORCE)`)
      await client.end()
    },
  }
}
