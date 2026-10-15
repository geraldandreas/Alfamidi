'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { 
  BarChart as ReBarChart, Bar as ReBar, XAxis as ReXAxis, YAxis as ReYAxis, 
  CartesianGrid as ReCartesianGrid, Tooltip as RechartsTooltipComponent, ResponsiveContainer as ReResponsiveContainer, 
  PieChart as RePieChart, Pie as RePie, Cell as ReCell, Legend as ReLegend 
} from 'recharts'
import { 
  Calendar, Hash, ChevronRight, CheckSquare, LayoutList, 
  Building2, Trophy, Globe, BarChart3, Store, Filter
} from 'lucide-react'
import BMTRekapDetailView from './BMTRekapDetailView'
import {
  CHILLER_EQUIPMENT_CHECKLIST_TOTAL,
  normalizeEquipmentTypeFromSubmission,
} from './chillerChecklistConfig'

type RecapType = 'fcpt' | 'chiller' | 'genset'

type StoreBase = {
  id: string
  kodeToko: string
  namaToko: string
  branch: string
  namaPic: string
}

type StoreData = StoreBase & {
  isDone: boolean
  submittedAt: string | null
  nilaiAkhir: number
  jmlTerceklist: number
  jmlTotal?: number
}

const RECAP_LABELS: Record<RecapType, string> = {
  fcpt: 'Rekap FCPT',
  chiller: 'Rekap Chiller',
  genset: 'Rekap Genset',
}

const FILTER_TYPE_MAP: Record<RecapType, string> = {
  fcpt: 'FCPT',
  chiller: 'Chiller',
  genset: 'Genset',
}

interface BMTRekapViewProps {
  nik?: string
  metadata?: any
  onSelectDetail?: (item: any, recapType?: string) => void
  onViewDetail?: (item: any, recapType?: string) => void
  defaultRecapType?: RecapType
}

export default function BMTRekapView({ nik, metadata, onSelectDetail, onViewDetail, defaultRecapType }: BMTRekapViewProps) {
  const [recapType, setRecapType] = useState<RecapType>(defaultRecapType || 'fcpt')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [filterTanggal, setFilterTanggal] = useState('')
  const [filterKodeToko, setFilterKodeToko] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selectedBranchFilter, setSelectedBranchFilter] = useState('all')
  const [viewTab, setViewTab] = useState<'cabang_saya' | 'perbandingan'>('cabang_saya')
  const [selectedItem, setSelectedItem] = useState<any>(null)
  const [storeBases, setStoreBases] = useState<StoreBase[]>([])
  const [fcptByKode, setFcptByKode] = useState<Record<string, { submitted_at: string; nilai_akhir: number; jml_terceklist: number }>>({})
  const [chillerByKode, setChillerByKode] = useState<
    Record<string, { types: Set<string>; latestAt: string | null; nilaiSum: number; nilaiCount: number }>
  >({})
  const [gensetByKode, setGensetByKode] = useState<
    Record<string, { submitted_at: string; nilai_akhir: number }>
  >({})
  const [loading, setLoading] = useState(true)

  const userRole = (metadata?.role || '').toLowerCase().trim()
  const rawUserBranch = (metadata?.cabang || metadata?.branch || '').trim()
  const [activeBranch, setActiveBranch] = useState(rawUserBranch)

  const isManagerCabang = 
    userRole === 'manager_cabang' || 
    userRole === 'admin' || 
    userRole === 'koordinator_cabang' || 
    userRole === 'estimator'

  const isMatchBranch = (branchName: string, targetBranch: string) => {
    if (!targetBranch) return true
    const b1 = (branchName || '').toLowerCase().replace(/midi\s*/g, '').trim()
    const b2 = targetBranch.toLowerCase().replace(/midi\s*/g, '').trim()
    return b1 === b2 || b1.includes(b2) || b2.includes(b1)
  }

  const rawStoresData = useMemo((): StoreData[] => {
    return storeBases.map((store) => {
      if (recapType === 'chiller') {
        const progress = chillerByKode[store.kodeToko]
        const doneCount = progress?.types.size ?? 0
        const total = CHILLER_EQUIPMENT_CHECKLIST_TOTAL
        const avgNilai =
          progress && progress.nilaiCount > 0
            ? Math.round(progress.nilaiSum / progress.nilaiCount)
            : 0
        return {
          ...store,
          isDone: doneCount >= total,
          submittedAt: progress?.latestAt ?? null,
          nilaiAkhir: avgNilai,
          jmlTerceklist: doneCount,
          jmlTotal: total,
        }
      }

      if (recapType === 'genset') {
        const sub = gensetByKode[store.kodeToko]
        return {
          ...store,
          isDone: !!sub,
          submittedAt: sub?.submitted_at ?? null,
          nilaiAkhir: sub?.nilai_akhir ?? 0,
          jmlTerceklist: sub ? 1 : 0,
        }
      }

      const sub = fcptByKode[store.kodeToko]
      return {
        ...store,
        isDone: !!sub,
        submittedAt: sub?.submitted_at ?? null,
        nilaiAkhir: sub?.nilai_akhir ?? 0,
        jmlTerceklist: sub?.jml_terceklist ?? 0,
      }
    })
  }, [storeBases, fcptByKode, chillerByKode, gensetByKode, recapType])

  useEffect(() => {
    const fetchBMTData = async () => {
      try {
        setLoading(true)
        const { createClient } = await import('@/frontend/supabase/client')
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const userNik = nik || user?.user_metadata?.nik || ''
        const userName = metadata?.full_name || user?.user_metadata?.full_name || ''

        let storeQuery = supabase
          .from('stores')
          .select('id, kode, nama, branch, nama_bmt, nik_bmt')

        if (userRole === 'bmt' || (!userRole && !isManagerCabang)) {
          if (userNik && userName) {
            storeQuery = storeQuery.or(`nik_bmt.eq."${userNik}",nama_bmt.ilike."%${userName}%"`)
          } else if (userNik) {
            storeQuery = storeQuery.eq('nik_bmt', userNik)
          } else if (userName) {
            storeQuery = storeQuery.ilike('nama_bmt', `%${userName}%`)
          }
        }

        const { data: storesData, error: storesError } = await storeQuery
          .order('branch', { ascending: true })
          .order('kode', { ascending: true })
          .limit(5000)

        if (storesError) {
          console.error('Stores Fetch Error Detail:', storesError.message, storesError.details)
          throw storesError
        }

        const storeCodes = (storesData || []).map(s => s.kode).filter(Boolean)
        const bases: StoreBase[] = (storesData || []).map((store) => ({
          id: store.id,
          kodeToko: store.kode,
          namaToko: store.nama,
          branch: store.branch || 'Unknown',
          namaPic: store.nama_bmt || userName || 'BMT Staff',
        }))

        if (!activeBranch && bases.length > 0) {
          const match = bases.find(b => isMatchBranch(b.branch, rawUserBranch))
          if (match) {
            setActiveBranch(match.branch)
          } else if (rawUserBranch) {
            setActiveBranch(rawUserBranch)
          } else {
            setActiveBranch(bases[0].branch)
          }
        }

        if (storeCodes.length === 0) {
          setStoreBases([])
          setFcptByKode({})
          setChillerByKode({})
          setGensetByKode({})
          setLoading(false)
          return
        }

        setStoreBases(bases)

        const startDate = new Date(selectedYear, selectedMonth - 1, 1).toISOString()
        const endDate = new Date(selectedYear, selectedMonth, 1).toISOString()

        let fcptQuery = supabase
          .from('view_rekap_fcpt')
          .select('store_kode, submitted_at, nilai_akhir, jml_terceklist')
          .gte('submitted_at', startDate)
          .lt('submitted_at', endDate)

        let chillerQuery = supabase
          .from('chiller_submissions')
          .select('store_kode, jenis_mesin, submitted_at, created_at, nilai_akhir')
          .gte('created_at', startDate)
          .lt('created_at', endDate)

        let gensetQuery = supabase
          .from('genset_submissions')
          .select('store_kode, submitted_at, created_at, nilai_akhir')
          .gte('created_at', startDate)
          .lt('created_at', endDate)

        if (userRole === 'bmt' && storeCodes.length > 0 && storeCodes.length <= 100) {
          fcptQuery = fcptQuery.in('store_kode', storeCodes)
          chillerQuery = chillerQuery.in('store_kode', storeCodes)
          gensetQuery = gensetQuery.in('store_kode', storeCodes)
        }

        const [fcptRes, chillerRes, gensetRes] = await Promise.all([
          fcptQuery,
          chillerQuery,
          gensetQuery,
        ])

        if (fcptRes.error) {
          console.error('FCPT Fetch Error:', fcptRes.error.message, fcptRes.error.details)
          throw fcptRes.error
        }

        const fcptMap: typeof fcptByKode = {}
        fcptRes.data?.forEach((sub: any) => {
          fcptMap[sub.store_kode] = sub
        })
        setFcptByKode(fcptMap)

        if (chillerRes.error) {
          console.error('Chiller Fetch Error:', chillerRes.error.message, chillerRes.error.details)
        } else {
          const chillerMap: typeof chillerByKode = {}
          chillerRes.data?.forEach((sub: any) => {
            const kode = sub.store_kode
            if (!kode) return
            if (!chillerMap[kode]) {
              chillerMap[kode] = { types: new Set(), latestAt: null, nilaiSum: 0, nilaiCount: 0 }
            }
            const bucket = chillerMap[kode]
            const equipmentType = normalizeEquipmentTypeFromSubmission(sub.jenis_mesin)
            if (equipmentType) bucket.types.add(equipmentType)
            const ts = sub.submitted_at || sub.created_at
            if (ts && (!bucket.latestAt || ts > bucket.latestAt)) {
              bucket.latestAt = ts
            }
            if (typeof sub.nilai_akhir === 'number') {
              bucket.nilaiSum += sub.nilai_akhir
              bucket.nilaiCount += 1
            }
          })
          setChillerByKode(chillerMap)
        }

        if (gensetRes.error) {
          console.error('Genset Fetch Error:', gensetRes.error.message, gensetRes.error.details)
        } else {
          const gMap: typeof gensetByKode = {}
          gensetRes.data?.forEach((sub: any) => {
            const kode = sub.store_kode
            if (!kode) return
            const ts = sub.submitted_at || sub.created_at
            if (!gMap[kode] || (ts && ts > gMap[kode].submitted_at)) {
              gMap[kode] = { submitted_at: ts, nilai_akhir: sub.nilai_akhir ?? 0 }
            }
          })
          setGensetByKode(gMap)
        }
      } catch (error: any) {
        console.error('Error fetching BMT rekap data:', error?.message || error?.details || error)
      } finally {
        setLoading(false)
      }
    }

    fetchBMTData()
  }, [nik, metadata, selectedMonth, selectedYear, userRole, isManagerCabang, rawUserBranch])

  const availableBranches = useMemo(() => {
    return Array.from(new Set(rawStoresData.map(s => s.branch).filter(Boolean))).sort()
  }, [rawStoresData])

  const myBranchStores = useMemo(() => {
    if (!isManagerCabang) return rawStoresData
    if (!activeBranch) return rawStoresData
    return rawStoresData.filter(s => isMatchBranch(s.branch, activeBranch))
  }, [rawStoresData, isManagerCabang, activeBranch])

  const myBranchFiltered = useMemo(() => {
    return myBranchStores.filter(item => {
      const matchKode = filterKodeToko === '' || 
        item.kodeToko.toLowerCase().includes(filterKodeToko.toLowerCase()) ||
        item.namaToko.toLowerCase().includes(filterKodeToko.toLowerCase())
      const matchDate = filterTanggal === '' || (item.submittedAt && item.submittedAt.startsWith(filterTanggal))
      
      let matchStatus = true
      if (filterStatus === 'done') {
        matchStatus = item.isDone
      } else if (filterStatus === 'pending') {
        matchStatus = !item.isDone
      }

      return matchKode && matchDate && matchStatus
    })
  }, [myBranchStores, filterKodeToko, filterTanggal, filterStatus])

  const kpiTerceklistCabang = myBranchFiltered.filter(d => d.isDone).length
  const totalTokoCabang = myBranchFiltered.length

  const pieChartDataCabang = useMemo(() => {
    if (totalTokoCabang === 0) return []
    
    const percentageDone = Number(((kpiTerceklistCabang / totalTokoCabang) * 100).toFixed(1))
    const percentagePending = Number((((totalTokoCabang - kpiTerceklistCabang) / totalTokoCabang) * 100).toFixed(1))
    
    return [
      { name: 'Sudah Dicek', value: percentageDone, fill: '#0c539a' },
      { name: 'Belum Dicek', value: percentagePending, fill: '#cc1e2c' }
    ].filter(item => item.value > 0)
  }, [kpiTerceklistCabang, totalTokoCabang])

  const branchComparisonData = useMemo(() => {
    const branchMap: Record<string, {
      branch: string
      target: number
      terceklist: number
      belumTerceklist: number
      percentage: number
      isUserBranch: boolean
      avgNilai: number
      totalNilai: number
    }> = {}

    rawStoresData.forEach(store => {
      const rawBranch = (store.branch || 'Lainnya').trim()
      if (!branchMap[rawBranch]) {
        branchMap[rawBranch] = {
          branch: rawBranch,
          target: 0,
          terceklist: 0,
          belumTerceklist: 0,
          percentage: 0,
          isUserBranch: isMatchBranch(rawBranch, activeBranch),
          avgNilai: 0,
          totalNilai: 0,
        }
      }
      branchMap[rawBranch].target += 1
      if (store.isDone) {
        branchMap[rawBranch].terceklist += 1
        branchMap[rawBranch].totalNilai += (store.nilaiAkhir || 0)
      } else {
        branchMap[rawBranch].belumTerceklist += 1
      }
    })

    return Object.values(branchMap)
      .map(item => ({
        ...item,
        percentage: item.target > 0 ? Number(((item.terceklist / item.target) * 100).toFixed(1)) : 0,
        avgNilai: item.terceklist > 0 ? Number((item.totalNilai / item.terceklist).toFixed(1)) : 0
      }))
      .sort((a, b) => b.percentage - a.percentage || b.terceklist - a.terceklist)
  }, [rawStoresData, activeBranch])

  const totalTargetNasional = useMemo(() => {
    return branchComparisonData.reduce((acc, curr) => acc + curr.target, 0)
  }, [branchComparisonData])

  const totalTerceklistNasional = useMemo(() => {
    return branchComparisonData.reduce((acc, curr) => acc + curr.terceklist, 0)
  }, [branchComparisonData])

  const percentageNasional = useMemo(() => {
    return totalTargetNasional > 0
      ? Number(((totalTerceklistNasional / totalTargetNasional) * 100).toFixed(1))
      : 0
  }, [totalTargetNasional, totalTerceklistNasional])

  const userBranchItem = useMemo(() => {
    return branchComparisonData.find(b => b.isUserBranch)
  }, [branchComparisonData])

  const userBranchRank = useMemo(() => {
    if (!userBranchItem) return null
    const idx = branchComparisonData.findIndex(b => b.isUserBranch)
    return idx !== -1 ? idx + 1 : null
  }, [branchComparisonData, userBranchItem])

  const topBranch = useMemo(() => {
    return branchComparisonData.length > 0 ? branchComparisonData[0] : null
  }, [branchComparisonData])

  const allFilteredData = useMemo(() => {
    return rawStoresData.filter(item => {
      const matchKode = filterKodeToko === '' || 
        item.kodeToko.toLowerCase().includes(filterKodeToko.toLowerCase()) ||
        item.namaToko.toLowerCase().includes(filterKodeToko.toLowerCase())
      const matchDate = filterTanggal === '' || (item.submittedAt && item.submittedAt.startsWith(filterTanggal))
      
      let matchStatus = true
      if (filterStatus === 'done') {
        matchStatus = item.isDone
      } else if (filterStatus === 'pending') {
        matchStatus = !item.isDone
      }

      let matchBranch = true
      if (selectedBranchFilter !== 'all') {
        matchBranch = item.branch.toLowerCase() === selectedBranchFilter.toLowerCase()
      }

      return matchKode && matchDate && matchStatus && matchBranch
    })
  }, [rawStoresData, filterKodeToko, filterTanggal, filterStatus, selectedBranchFilter])

  const barChartDataCabang = useMemo(() => {
    const stats: Record<string, { name: string, terceklist: number, belumTerceklist: number }> = {}
    
    myBranchFiltered.forEach(d => {
      if (!stats[d.branch]) {
        stats[d.branch] = { name: d.branch, terceklist: 0, belumTerceklist: 0 }
      }
      if (d.isDone) stats[d.branch].terceklist += 1
      else stats[d.branch].belumTerceklist += 1
    })

    return Object.values(stats)
  }, [myBranchFiltered])

  const handleSelectDetail = (item: StoreData) => {
    const currentFilterType = FILTER_TYPE_MAP[recapType] || 'FCPT'
    const itemWithRecap = {
      ...item,
      recapType,
      filterType: currentFilterType,
    }

    if (onViewDetail) {
      onViewDetail(itemWithRecap, recapType)
    } else if (onSelectDetail) {
      onSelectDetail(itemWithRecap, recapType)
    } else {
      setSelectedItem(itemWithRecap)
    }
  }

  if (selectedItem && !onSelectDetail && !onViewDetail) {
    return (
      <BMTRekapDetailView 
        data={selectedItem} 
        filterType={selectedItem.filterType || FILTER_TYPE_MAP[recapType] || 'FCPT'} 
        onBack={() => setSelectedItem(null)} 
      />
    )
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="animate-spin w-8 h-8 border-4 border-[#0c539a] border-t-transparent rounded-full" />
      <p className="text-xs text-gray-500 font-bold">Memuat data rekapitulasi...</p>
    </div>
  )

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-7xl mx-auto font-sans"
    >
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 border-b border-gray-100 pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-bold text-gray-800">Rekapitulasi</span>
              <span className="relative inline-flex items-center">
                <LayoutList className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0c539a] pointer-events-none" size={16} />
                <select
                  value={recapType}
                  onChange={(e) => setRecapType(e.target.value as RecapType)}
                  className="appearance-none pl-9 pr-8 py-1.5 rounded-lg border-2 border-[#0c539a]/30 bg-blue-50/80 text-[#0c539a] text-base font-bold cursor-pointer focus:ring-2 focus:ring-[#0c539a] outline-none hover:bg-blue-50 transition-colors"
                  aria-label="Jenis rekapitulasi"
                >
                  <option value="fcpt">{RECAP_LABELS.fcpt}</option>
                  <option value="chiller">{RECAP_LABELS.chiller}</option>
                  <option value="genset">{RECAP_LABELS.genset}</option>
                </select>
              </span>
              <span className="text-xl font-bold text-gray-800">
                {isManagerCabang ? `Area ${activeBranch || 'Cabang'}` : 'Area BMT'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <select 
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#0c539a]"
              >
                {['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'].map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
              <select 
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#0c539a]"
              >
                {[2024, 2025, 2026, 2027].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>

              {isManagerCabang && availableBranches.length > 1 && (
                <div className="relative inline-flex items-center">
                  <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <select
                    value={activeBranch}
                    onChange={(e) => setActiveBranch(e.target.value)}
                    className="appearance-none pl-8 pr-7 py-1.5 bg-blue-50/70 border border-blue-200 rounded-lg text-xs font-bold text-[#0c539a] hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-[#0c539a] cursor-pointer"
                    aria-label="Pilih Cabang Anda"
                  >
                    {availableBranches.map(b => (
                      <option key={b} value={b}>Cabang: {b}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500 font-medium mt-1.5">
              {viewTab === 'cabang_saya' || !isManagerCabang
                ? `Menampilkan ${totalTokoCabang} toko yang ditugaskan kepada Anda.`
                : `Membandingkan target toko vs realisasi checklist per branch se-nasional. Total: ${totalTerceklistNasional} dari ${totalTargetNasional} toko terceklist (${percentageNasional}%).`
              }
              {recapType === 'chiller' && (
                <span className="block text-[11px] text-gray-400 mt-0.5">
                  Toko dianggap selesai jika seluruh {CHILLER_EQUIPMENT_CHECKLIST_TOTAL} jenis perangkat pendingin sudah diceklist.
                </span>
              )}
            </p>
          </div>

          {isManagerCabang && (
            <div className="flex items-center bg-gray-100 p-1 rounded-xl self-start sm:self-center">
              <button
                onClick={() => setViewTab('cabang_saya')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                  viewTab === 'cabang_saya'
                    ? 'bg-white text-[#cc1e2c] shadow-sm font-black'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Store size={15} />
                <span>Toko Cabang Saya</span>
              </button>
              <button
                onClick={() => setViewTab('perbandingan')}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                  viewTab === 'perbandingan'
                    ? 'bg-white text-[#0c539a] shadow-sm font-black'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <BarChart3 size={15} />
                <span>Perbandingan Antar Cabang</span>
              </button>
            </div>
          )}
        </div>

        {isManagerCabang && viewTab === 'cabang_saya' && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50/50 border border-blue-200/60 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#0c539a] mb-6">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-[#0c539a] shrink-0" />
              <span>
                Sedang melihat toko <strong>Cabang {activeBranch}</strong>. Ingin membandingkan persentase capaian dengan cabang lain?
              </span>
            </div>
            <button
              onClick={() => setViewTab('perbandingan')}
              className="font-bold underline hover:text-blue-900 cursor-pointer shrink-0"
            >
              Buka Perbandingan Antar Cabang ➔
            </button>
          </div>
        )}

        {viewTab === 'cabang_saya' || !isManagerCabang ? (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Rentang Tanggal</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input 
                    type="date" 
                    value={filterTanggal}
                    onChange={(e) => setFilterTanggal(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 placeholder-gray-500 focus:ring-2 focus:ring-red-500 outline-none" 
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Status Inspection</label>
                <div className="relative">
                  <CheckSquare className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <select 
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 placeholder-gray-500 focus:ring-2 focus:ring-red-500 outline-none appearance-none font-medium cursor-pointer"
                  >
                    <option value="all">Semua Toko (Sudah & Belum)</option>
                    <option value="done">Sudah Terceklist</option>
                    <option value="pending">Belum Terceklist</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Cari Kode Toko</label>
                <div className="relative">
                  <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input 
                    type="text" 
                    value={filterKodeToko}
                    onChange={(e) => setFilterKodeToko(e.target.value)}
                    placeholder="Contoh: NC42 / SC1M"
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 placeholder-gray-500 focus:ring-2 focus:ring-red-500 outline-none" 
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-1 flex flex-col justify-center">
              <div className="bg-gradient-to-br from-[#0c539a] to-blue-800 rounded-2xl p-6 text-white shadow-md text-center h-full flex flex-col justify-center transform transition hover:scale-105">
                <p className="text-blue-200 font-semibold mb-1 text-sm">Sudah Terceklist</p>
                <h3 className="text-5xl font-black tracking-tight">{kpiTerceklistCabang} <span className="text-2xl font-normal text-blue-200">/ {totalTokoCabang}</span></h3>
                <p className="text-[11px] text-blue-100 mt-2 font-medium">Toko Dalam Pengawasan Anda</p>
              </div>
            </div>

            <div className="lg:col-span-2 flex justify-center items-center bg-gray-50 rounded-2xl border border-gray-100 p-4">
              <div className="w-full h-[300px]">
                {pieChartDataCabang.length > 0 ? (
                  <ReResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <RePie
                        data={pieChartDataCabang}
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="value"
                        label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}
                      >
                        {pieChartDataCabang.map((entry, index) => (
                          <ReCell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </RePie>
                      <RechartsTooltipComponent formatter={(value) => `${value}%`} />
                      <ReLegend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '12px' }} />
                    </RePieChart>
                  </ReResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-400 font-medium text-xs">
                    Belum ada laporan checklist selesai
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-[#cc1e2c] to-red-800 rounded-2xl p-5 text-white shadow-md relative overflow-hidden flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-extrabold tracking-wider bg-white/20 px-2.5 py-0.5 rounded-full">
                    Cabang Anda
                  </span>
                  <Building2 size={20} className="text-white/80" />
                </div>
                <div>
                  <h4 className="text-lg font-bold truncate">
                    {userBranchItem ? userBranchItem.branch : (activeBranch || 'Belum Terdaftar')}
                  </h4>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-4xl font-black">
                      {userBranchItem ? `${userBranchItem.percentage}%` : '0%'}
                    </span>
                    <span className="text-sm font-medium text-red-100">
                      ({userBranchItem ? userBranchItem.terceklist : 0} / {userBranchItem ? userBranchItem.target : 0} Toko)
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/20 flex items-center justify-between text-xs text-red-100 font-medium">
                  <span>
                    {userBranchRank ? `Peringkat #${userBranchRank} dari ${branchComparisonData.length} Cabang` : 'Target Checklist'}
                  </span>
                  <span>
                    Sisa: {userBranchItem ? userBranchItem.belumTerceklist : 0} Toko
                  </span>
                </div>
              </div>

              <div className="bg-gradient-to-br from-[#0c539a] to-blue-900 rounded-2xl p-5 text-white shadow-md relative overflow-hidden flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-extrabold tracking-wider bg-white/20 px-2.5 py-0.5 rounded-full">
                    Total Nasional
                  </span>
                  <Globe size={20} className="text-white/80" />
                </div>
                <div>
                  <h4 className="text-lg font-bold">Semua Cabang</h4>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-4xl font-black">{percentageNasional}%</span>
                    <span className="text-sm font-medium text-blue-100">
                      ({totalTerceklistNasional} / {totalTargetNasional} Toko)
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/20 flex items-center justify-between text-xs text-blue-100 font-medium">
                  <span>{branchComparisonData.length} Cabang Terpantau</span>
                  <span>Sisa: {totalTargetNasional - totalTerceklistNasional} Toko</span>
                </div>
              </div>

              <div className="bg-gradient-to-br from-amber-500 to-amber-700 rounded-2xl p-5 text-white shadow-md relative overflow-hidden flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-extrabold tracking-wider bg-white/25 px-2.5 py-0.5 rounded-full">
                    Cabang Tertinggi
                  </span>
                  <Trophy size={20} className="text-white/90" />
                </div>
                <div>
                  <h4 className="text-lg font-bold truncate">
                    {topBranch ? topBranch.branch : '-'}
                  </h4>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-4xl font-black">
                      {topBranch ? `${topBranch.percentage}%` : '0%'}
                    </span>
                    <span className="text-sm font-medium text-amber-100">
                      ({topBranch ? topBranch.terceklist : 0} / {topBranch ? topBranch.target : 0} Toko)
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/20 flex items-center justify-between text-xs text-amber-100 font-medium">
                  <span>Pencapaian Tertinggi Periode Ini</span>
                  <span>{topBranch?.percentage === 100 ? 'Target Lengkap 100%' : 'Memimpin Progres'}</span>
                </div>
              </div>
            </div>

            <div className="bg-gray-50/70 p-5 rounded-2xl border border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                    <BarChart3 className="text-[#0c539a]" size={18} />
                    Bagan Perbandingan Persentase Checklist Antar Cabang
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Tinggi batang menunjukkan persentase (%) toko yang sudah terceklist dari target masing-masing cabang.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-[#cc1e2c]" />
                    <span className="text-gray-700">Cabang Anda ({activeBranch})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-[#0c539a]" />
                    <span className="text-gray-700">Cabang Lain</span>
                  </div>
                </div>
              </div>

              <div className="w-full h-[320px]">
                {branchComparisonData.length > 0 ? (
                  <ReResponsiveContainer width="100%" height="100%">
                    <ReBarChart 
                      data={branchComparisonData} 
                      margin={{ top: 25, right: 20, left: 0, bottom: 25 }}
                    >
                      <ReCartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <ReXAxis 
                        dataKey="branch" 
                        tick={{ fill: '#334155', fontSize: 11, fontWeight: 700 }}
                        axisLine={{ stroke: '#cbd5e1' }}
                        tickLine={false}
                        interval={0}
                      />
                      <ReYAxis 
                        domain={[0, 100]} 
                        tick={{ fill: '#64748b', fontSize: 11 }}
                        unit="%"
                        axisLine={{ stroke: '#cbd5e1' }}
                        tickLine={false}
                      />
                      <RechartsTooltipComponent 
                        content={({ active, payload }) => {
                          if (!active || !payload || !payload.length) return null
                          const d = payload[0].payload
                          return (
                            <div className="bg-white p-3.5 rounded-xl shadow-xl border border-gray-100 text-xs z-50">
                              <div className="flex items-center justify-between gap-3 font-bold text-gray-900 border-b pb-1.5 mb-2">
                                <span className="text-sm">{d.branch}</span>
                                {d.isUserBranch ? (
                                  <span className="bg-red-100 text-[#cc1e2c] text-[10px] px-2 py-0.5 rounded font-black">
                                    Cabang Anda
                                  </span>
                                ) : null}
                              </div>
                              <div className="space-y-1.5 text-gray-600">
                                <div className="flex justify-between gap-4">
                                  <span>Persentase Checklist:</span>
                                  <span className="font-black text-[#0c539a] text-sm">{d.percentage}%</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span>Sudah Terceklist:</span>
                                  <span className="font-bold text-emerald-600">{d.terceklist} Toko</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span>Target (Total Toko):</span>
                                  <span className="font-bold text-gray-800">{d.target} Toko</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span>Belum Terceklist:</span>
                                  <span className="font-bold text-red-500">{d.belumTerceklist} Toko</span>
                                </div>
                              </div>
                            </div>
                          )
                        }}
                      />
                      <ReBar 
                        dataKey="percentage" 
                        radius={[6, 6, 0, 0]}
                        maxBarSize={55}
                      >
                        {branchComparisonData.map((entry, index) => (
                          <ReCell 
                            key={`cell-${index}`} 
                            fill={entry.isUserBranch ? '#cc1e2c' : '#0c539a'} 
                          />
                        ))}
                      </ReBar>
                    </ReBarChart>
                  </ReResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-400 font-medium text-xs">
                    Belum ada data toko cabang
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 bg-gray-50/70 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                    <Trophy size={16} className="text-amber-500" />
                    Peringkat & Perbandingan Target vs Realisasi Per Branch
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Urutan performa cabang dari persentase checklist tertinggi hingga terendah.
                  </p>
                </div>
                {selectedBranchFilter !== 'all' && (
                  <button 
                    onClick={() => setSelectedBranchFilter('all')}
                    className="text-xs font-bold text-[#0c539a] hover:underline"
                  >
                    Reset Filter Cabang (Tampilkan Semua)
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-[#0c539a] text-white">
                    <tr>
                      <th className="px-5 py-3.5 font-bold text-center w-16">PERINGKAT</th>
                      <th className="px-5 py-3.5 font-bold">CABANG</th>
                      <th className="px-5 py-3.5 font-bold text-center">TARGET (TOTAL TOKO)</th>
                      <th className="px-5 py-3.5 font-bold text-center">SUDAH TERCEKLIST</th>
                      <th className="px-5 py-3.5 font-bold text-center">BELUM TERCEKLIST</th>
                      <th className="px-5 py-3.5 font-bold">PERSENTASE CHECKLIST</th>
                      <th className="px-5 py-3.5 font-bold text-center">STATUS</th>
                      <th className="px-5 py-3.5 font-bold text-center">AKSI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {branchComparisonData.length > 0 ? (
                      branchComparisonData.map((item, idx) => {
                        const isUser = item.isUserBranch
                        const isSelected = selectedBranchFilter.toLowerCase() === item.branch.toLowerCase()
                        return (
                          <tr 
                            key={item.branch} 
                            className={`transition-colors ${
                              isSelected 
                                ? 'bg-blue-50/80 font-semibold' 
                                : isUser 
                                  ? 'bg-red-50/40 hover:bg-red-50/70' 
                                  : 'hover:bg-gray-50/70'
                            }`}
                          >
                            <td className="px-5 py-3.5 text-center font-black text-gray-700">
                              {idx === 0 ? (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400 text-white text-xs shadow-sm">
                                  🥇
                                </span>
                              ) : idx === 1 ? (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-300 text-slate-800 text-xs shadow-sm">
                                  🥈
                                </span>
                              ) : idx === 2 ? (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-600 text-white text-xs shadow-sm">
                                  🥉
                                </span>
                              ) : (
                                `#${idx + 1}`
                              )}
                            </td>
                            <td className="px-5 py-3.5 font-bold text-gray-900">
                              <div className="flex items-center gap-2">
                                <span>{item.branch}</span>
                                {isUser && (
                                  <span className="bg-red-100 text-[#cc1e2c] border border-red-200 text-[10px] font-black px-2 py-0.5 rounded-full">
                                    Cabang Anda
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-center font-bold text-gray-800">
                              {item.target} Toko
                            </td>
                            <td className="px-5 py-3.5 text-center font-bold text-emerald-600">
                              {item.terceklist} Toko
                            </td>
                            <td className="px-5 py-3.5 text-center font-medium text-gray-500">
                              {item.belumTerceklist} Toko
                            </td>
                            <td className="px-5 py-3.5 min-w-[160px]">
                              <div className="flex items-center gap-2.5">
                                <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden border border-gray-200/50">
                                  <div 
                                    className={`h-full rounded-full transition-all duration-500 ${
                                      item.percentage >= 100 ? 'bg-emerald-500' :
                                      item.percentage >= 75 ? 'bg-[#0c539a]' :
                                      item.percentage >= 50 ? 'bg-amber-500' : 'bg-[#cc1e2c]'
                                    }`}
                                    style={{ width: `${Math.min(item.percentage, 100)}%` }}
                                  />
                                </div>
                                <span className="font-extrabold text-xs text-gray-800 min-w-[42px] text-right">
                                  {item.percentage}%
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-center">
                              {item.percentage >= 100 ? (
                                <span className="inline-block bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full">
                                  Tercapai 100%
                                </span>
                              ) : item.percentage >= 75 ? (
                                <span className="inline-block bg-blue-100 text-[#0c539a] text-xs font-bold px-2.5 py-1 rounded-full">
                                  Sangat Baik
                                </span>
                              ) : item.percentage >= 50 ? (
                                <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full">
                                  On Progress
                                </span>
                              ) : (
                                <span className="inline-block bg-red-100 text-red-700 text-xs font-bold px-2.5 py-1 rounded-full">
                                  Perlu Dipacu
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 text-center">
                              <button
                                onClick={() => {
                                  setSelectedBranchFilter(isSelected ? 'all' : item.branch)
                                  const el = document.getElementById('daftar-toko-section')
                                  if (el) el.scrollIntoView({ behavior: 'smooth' })
                                }}
                                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                                  isSelected
                                    ? 'bg-[#0c539a] text-white shadow-sm'
                                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                }`}
                              >
                                {isSelected ? 'Terfilter ✓' : 'Lihat Toko'}
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="px-6 py-8 text-center text-gray-400 font-medium">
                          Tidak ada data perbandingan cabang
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <div id="daftar-toko-section" className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
              <Store size={18} className="text-[#0c539a]" />
              {isManagerCabang && viewTab === 'cabang_saya'
                ? `Daftar Toko Cabang ${activeBranch} (${myBranchFiltered.length})`
                : `Daftar Toko (${(viewTab === 'cabang_saya' || !isManagerCabang ? myBranchFiltered : allFilteredData).length})`
              }
            </h3>
            {isManagerCabang && viewTab === 'perbandingan' && selectedBranchFilter !== 'all' && (
              <p className="text-xs text-[#0c539a] font-semibold mt-0.5">
                Menampilkan toko di cabang: <strong>{selectedBranchFilter}</strong>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {isManagerCabang && viewTab === 'perbandingan' && (
              <div className="relative min-w-[160px]">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
                <select
                  value={selectedBranchFilter}
                  onChange={(e) => setSelectedBranchFilter(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-[#0c539a] cursor-pointer"
                  aria-label="Filter Cabang"
                >
                  <option value="all">Semua Cabang ({rawStoresData.length})</option>
                  {activeBranch && (
                    <option value={activeBranch}>⭐ Cabang Anda ({activeBranch})</option>
                  )}
                  {availableBranches.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            )}

            {isManagerCabang && viewTab === 'cabang_saya' && availableBranches.length > 1 && (
              <div className="relative min-w-[160px]">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
                <select
                  value={activeBranch}
                  onChange={(e) => setActiveBranch(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-[#0c539a] cursor-pointer"
                  aria-label="Pilih Cabang"
                >
                  {availableBranches.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="relative min-w-[140px]">
              <CheckSquare className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-[#0c539a] cursor-pointer"
                aria-label="Filter Status"
              >
                <option value="all">Semua Status</option>
                <option value="done">Sudah Terceklist</option>
                <option value="pending">Belum Terceklist</option>
              </select>
            </div>

            <div className="relative min-w-[180px]">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
              <input
                type="text"
                value={filterKodeToko}
                onChange={(e) => setFilterKodeToko(e.target.value)}
                placeholder="Cari kode/nama toko..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-800 outline-none focus:ring-2 focus:ring-[#0c539a]"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-auto max-h-[480px]">
          <table className="w-full text-sm text-left relative">
            <thead className="bg-[#cc1e2c] text-white sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-6 py-4 font-bold text-center w-14">NO</th>
                <th className="px-6 py-4 font-bold">KODE TOKO</th>
                <th className="px-6 py-4 font-bold">NAMA TOKO</th>
                {(isManagerCabang && viewTab === 'perbandingan') && (
                  <th className="px-6 py-4 font-bold">CABANG</th>
                )}
                <th className="px-6 py-4 font-bold">PIC BMT</th>
                <th className="px-6 py-4 font-bold text-center">NILAI AKHIR</th>
                <th className="px-6 py-4 font-bold text-center">JML TERCEKLIST</th>
                <th className="px-6 py-4 font-bold text-center">AKSI</th>
              </tr>
            </thead>
            <tbody>
              {((viewTab === 'cabang_saya' || !isManagerCabang ? myBranchFiltered : allFilteredData).length > 0) ? (
                (viewTab === 'cabang_saya' || !isManagerCabang ? myBranchFiltered : allFilteredData).map((row, i) => (
                  <tr key={row.id} className="border-b border-gray-50 hover:bg-red-50/30 transition-colors">
                    <td className="px-6 py-4 text-center text-gray-500 font-medium">{i + 1}.</td>
                    <td className="px-6 py-4 font-bold text-gray-800">{row.kodeToko}</td>
                    <td className="px-6 py-4 text-gray-700 truncate max-w-[220px] font-medium">{row.namaToko}</td>
                    {(isManagerCabang && viewTab === 'perbandingan') && (
                      <td className="px-6 py-4 text-gray-600 font-semibold">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          isMatchBranch(row.branch, activeBranch) 
                            ? 'bg-red-100 text-[#cc1e2c] font-black' 
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {row.branch}
                        </span>
                      </td>
                    )}
                    <td className="px-6 py-4 text-gray-600">{row.namaPic}</td>
                    <td className={`px-6 py-4 text-center font-bold ${
                      row.jmlTerceklist > 0
                        ? row.nilaiAkhir >= 90
                          ? 'text-emerald-600'
                          : 'text-red-600'
                        : 'text-gray-400'
                    }`}>
                      {row.jmlTerceklist > 0 ? row.nilaiAkhir : '-'}
                    </td>
                    <td className="px-6 py-4 text-center font-bold text-gray-800">
                      {recapType === 'chiller' && row.jmlTotal != null
                        ? `${row.jmlTerceklist} / ${row.jmlTotal}`
                        : row.isDone
                          ? row.jmlTerceklist
                          : '0'}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button 
                        onClick={() => handleSelectDetail(row)} 
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#0c539a] hover:bg-blue-800 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
                      >
                        Detail <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={(isManagerCabang && viewTab === 'perbandingan') ? 8 : 7} className="text-center py-12 text-gray-400 font-medium">
                    Tidak ada toko yang cocok dengan filter yang dipilih.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(viewTab === 'cabang_saya' || !isManagerCabang) && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-6 text-sm">
            Status Inspeksi Toko Pegangan
          </h3>
          <div className="w-full h-[280px]">
            {barChartDataCabang.length > 0 ? (
              <ReResponsiveContainer width="100%" height="100%">
                <ReBarChart data={barChartDataCabang} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                  <ReCartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <ReXAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <ReYAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                  <RechartsTooltipComponent cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <ReLegend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }} />
                  <ReBar dataKey="terceklist" name="Sudah Terceklist" fill="#0c539a" radius={[4, 4, 0, 0]} barSize={24} />
                  <ReBar dataKey="belumTerceklist" name="Belum Terceklist" fill="#cc1e2c" radius={[4, 4, 0, 0]} barSize={24} />
                </ReBarChart>
              </ReResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400 font-medium text-xs">
                Data Grafik Kosong
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}