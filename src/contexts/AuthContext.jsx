import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile
} from 'firebase/auth'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'

const AuthContext = createContext(null)

// บัญชีที่สมัครใหม่จะยังไม่มี role/active จนกว่า admin จะอนุมัติใน "จัดการผู้ใช้"
// กันคนนอกสมัครแล้วใช้งานระบบได้ทันที
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = ยังไม่รู้สถานะ, null = ไม่ได้ login
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u ?? null)), [])

  useEffect(() => {
    if (!user) {
      setProfile(null)
      return
    }
    setProfileLoading(true)
    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null)
        setProfileLoading(false)
      },
      () => setProfileLoading(false)
    )
    return unsub
  }, [user])

  const value = useMemo(
    () => ({
      user,
      profile,
      loading: user === undefined || profileLoading,
      isApproved: Boolean(profile?.active && profile?.role),
      async signIn(email, password) {
        await signInWithEmailAndPassword(auth, email, password)
      },
      async signUp(name, email, password) {
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(cred.user, { displayName: name })
        await setDoc(doc(db, 'users', cred.user.uid), {
          name,
          email,
          role: null, // รอ admin กำหนด role
          department: '',
          active: false, // รอ admin อนุมัติ
          created_at: serverTimestamp()
        })
      },
      async signOut() {
        await firebaseSignOut(auth)
      }
    }),
    [user, profile, profileLoading]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องใช้ภายใน <AuthProvider>')
  return ctx
}
