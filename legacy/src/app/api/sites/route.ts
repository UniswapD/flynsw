import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sites } from '@/db/schema';

export async function GET() {
  try {
    const allSites = await db.select().from(sites).orderBy(sites.region, sites.name);
    return NextResponse.json(allSites);
  } catch (error) {
    console.error('Error fetching sites:', error);
    return NextResponse.json({ error: 'Failed to fetch sites' }, { status: 500 });
  }
}
