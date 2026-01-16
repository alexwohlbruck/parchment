import { db } from '../db'
import { encryptedLocations } from '../schema/location.schema'
import { eq } from 'drizzle-orm'

async function main() {
  const result = await db
    .delete(encryptedLocations)
    .where(eq(encryptedLocations.id, 'MdlNnU4CyTAsRGYS1XKalapx'))
    .returning()
  
  console.log('Deleted:', result.length, 'records')
  process.exit(0)
}

main().catch(console.error)
