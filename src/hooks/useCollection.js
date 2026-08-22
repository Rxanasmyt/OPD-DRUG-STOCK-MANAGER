import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'

/**
 * subscribe แบบ live กับ Firestore query/collection reference
 * ใช้ onSnapshot (ไม่ใช่ getDocs ครั้งเดียว) เพื่อให้ Firestore cache ข้อมูลไว้ใช้ตอนออฟไลน์ได้ต่อเนื่อง
 * @param {import('firebase/firestore').Query|import('firebase/firestore').CollectionReference|null} refOrQuery
 */
export function useCollection(refOrQuery, deps = []) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!refOrQuery) {
      setData([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = onSnapshot(
      refOrQuery,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
        setError(null)
      },
      (err) => {
        setError(err)
        setLoading(false)
      }
    )
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error }
}
