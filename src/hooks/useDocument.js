import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'

/** subscribe แบบ live กับ Firestore document reference เดียว */
export function useDocument(ref, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ref) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setData(snap.exists() ? { id: snap.id, ...snap.data() } : null)
        setLoading(false)
      },
      () => setLoading(false)
    )
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading }
}
