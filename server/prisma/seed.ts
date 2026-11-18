import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ROLES = [
  { code: 'PM_REQUESTER', name: 'PM / Requester' },
  { code: 'PROCUREMENT', name: 'Procurement' },
  { code: 'VENDOR', name: 'Vendor' },
  { code: 'APPROVER', name: 'Approver / Owner' },
  { code: 'ADMIN', name: 'Admin' },
] as const;

async function main() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name },
      create: role,
    });
  }

  // Confirmed business rule: at least 3 valid quotations (configurable).
  await prisma.systemSetting.upsert({
    where: { key: 'procurement.min_valid_quotations' },
    update: {},
    create: { key: 'procurement.min_valid_quotations', value: 3 },
  });

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before seeding');
  }

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { code: 'ADMIN' },
  });
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      fullName: 'System Admin',
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, roleId: adminRole.id },
  });

  console.log(`Seed done. Admin: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());