import { useEffect, useState } from 'react'
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'

/**
 * นับจำนวนธุรกรรมของผู้ใช้คนนี้ที่ยังไม่ได้ sync ขึ้น server (ค้างอยู่เพราะออฟไลน์)
 * อาศัย metadata.hasPendingWrites ของ Firestore SDK โดยตรง ไม่ต้องทำ queue เอง
 */
export function usePendingWrites() {
  const { user } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (!user) {
      setPendingCount(0)
      return
    }
    const q = query(
      collection(db, 'transactions'),
      where('performed_by', '==', user.uid),
      orderBy('created_at_client', 'desc'),
      limit(50)
    )
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const pending = snap.docs.filter((d) => d.metadata.hasPendingWrites).length
        setPendingCount(pending)
      },
      () => setPendingCount(0)
    )
    return unsub
  }, [user])

  return pendingCount
}
