// Best-effort category suggestion from a drug's name — the engine behind both the one-tap
// "ระบบแนะนำหมวด" chip in MedsScreen's add/edit form AND autoCategorizeAll() in AppContext.tsx
// (the bulk "จัดหมวดหมู่อัตโนมัติ" action, run once against the live ~600-item formulary).
//
// The keyword list below is deliberately broad — generic names, common Thai hospital formulary
// items, and a handful of non-drug supply items — covering the WHO Essential Medicines List
// items and their local equivalents that make up the bulk of a Thai district hospital OPD/IPD
// formulary. It will not know every brand name or unusual formulation; anything unmatched
// simply gets no suggestion (falls back to "ยังไม่ระบุหมวด" like before this feature existed) —
// never a forced/guessed category. autoCategorizeAll() only ever WRITES a category when this
// returns non-null, and only to a med that doesn't already have one — a human choice already
// made on a med's category is never silently overwritten by this getting run again later.
import { UNCATEGORIZED } from './categories';

// Order matters: checked top-to-bottom, first match wins. More specific keywords (e.g.
// "insulin") are listed before broad ones so a drug name can't fall into the wrong bucket just
// because it also happens to contain a generic word.
const RULES: [string, string][] = [
  // ยาแก้ปวด/ลดไข้/ต้านอักเสบ (NSAID)
  ['paracetamol', 'pain'], ['acetaminophen', 'pain'], ['ibuprofen', 'pain'], ['diclofenac', 'pain'],
  ['naproxen', 'pain'], ['mefenamic', 'pain'], ['celecoxib', 'pain'], ['etoricoxib', 'pain'],
  ['piroxicam', 'pain'], ['indomethacin', 'pain'], ['ketorolac', 'pain'], ['tramadol', 'pain'],
  ['aspirin', 'pain'], ['colchicine', 'pain'], ['allopurinol', 'pain'], ['febuxostat', 'pain'],
  ['morphine', 'pain'], ['pethidine', 'pain'], ['sulfinpyrazone', 'pain'], ['tenoxicam', 'pain'],
  ['พาราเซตามอล', 'pain'], ['ทรามาดอล', 'pain'],
  // ยาสเตียรอยด์/คอร์ติโคสเตียรอยด์
  ['prednisolone', 'steroid'], ['dexamethasone', 'steroid'], ['hydrocortisone inj', 'steroid'],
  ['hydrocortisone sodium', 'steroid'], ['hydrocortisone - pl', 'steroid'], ['hydrocortisone vial', 'steroid'],
  ['methylprednisolone', 'steroid'], ['triamcinolone', 'steroid'],
  ['betamethasone inj', 'steroid'], ['betamethasone tab', 'steroid'],
  // ยาต้านจุลชีพ
  ['amoxicillin', 'antimicrobial'], ['co-amoxiclav', 'antimicrobial'], ['amoxy', 'antimicrobial'],
  ['cloxacillin', 'antimicrobial'], ['dicloxacillin', 'antimicrobial'], ['ampicillin', 'antimicrobial'],
  ['penicillin v', 'antimicrobial'], ['benzathine', 'antimicrobial'], ['procaine penicillin', 'antimicrobial'],
  ['cephalexin', 'antimicrobial'], ['cefalexin', 'antimicrobial'], ['cefazolin', 'antimicrobial'], ['cefuroxime', 'antimicrobial'],
  ['clotrimazole troche', 'antimicrobial'], ['clotrimazole vagina', 'antimicrobial'],
  ['cefotaxime', 'antimicrobial'], ['ceftriaxone', 'antimicrobial'], ['ceftazidime', 'antimicrobial'],
  ['cefixime', 'antimicrobial'], ['cefdinir', 'antimicrobial'], ['cefpodoxime', 'antimicrobial'],
  ['azithromycin', 'antimicrobial'], ['clarithromycin', 'antimicrobial'], ['erythromycin', 'antimicrobial'],
  ['roxithromycin', 'antimicrobial'], ['ciprofloxacin', 'antimicrobial'], ['ofloxacin', 'antimicrobial'],
  ['levofloxacin', 'antimicrobial'], ['norfloxacin', 'antimicrobial'], ['moxifloxacin', 'antimicrobial'],
  ['doxycycline', 'antimicrobial'], ['tetracycline', 'antimicrobial'], ['metronidazole', 'antimicrobial'],
  ['tinidazole', 'antimicrobial'], ['clindamycin', 'antimicrobial'], ['co-trimoxazole', 'antimicrobial'],
  ['cotrimoxazole', 'antimicrobial'], ['trimethoprim', 'antimicrobial'], ['sulfamethoxazole', 'antimicrobial'],
  ['gentamicin', 'antimicrobial'], ['amikacin', 'antimicrobial'], ['vancomycin', 'antimicrobial'],
  ['meropenem', 'antimicrobial'], ['imipenem', 'antimicrobial'], ['piperacillin', 'antimicrobial'],
  ['fluconazole', 'antimicrobial'], ['ketoconazole', 'antimicrobial'], ['itraconazole', 'antimicrobial'],
  ['griseofulvin', 'antimicrobial'], ['nystatin', 'antimicrobial'], ['acyclovir', 'antimicrobial'],
  ['valacyclovir', 'antimicrobial'], ['oseltamivir', 'antimicrobial'], ['penicillin', 'antimicrobial'],
  ['isoniazid', 'antimicrobial'], ['rifampicin', 'antimicrobial'], ['ethambutol', 'antimicrobial'],
  ['pyrazinamide', 'antimicrobial'], ['albendazole', 'antimicrobial'], ['mebendazole', 'antimicrobial'],
  ['artesunate', 'antimicrobial'], ['อะม็อกซี่', 'antimicrobial'], ['ปฏิชีวนะ', 'antimicrobial'],
  ['amoxi/clav', 'antimicrobial'], ['augmentin', 'antimicrobial'], ['bactrim', 'antimicrobial'],
  ['ceftriazone', 'antimicrobial'], ['cef-3', 'antimicrobial'], ['chloroquine', 'antimicrobial'],
  ['colistin', 'antimicrobial'], ['ethambutal', 'antimicrobial'], ['fosfomycin', 'antimicrobial'],
  ['tazocin', 'antimicrobial'], ['sulbactam', 'antimicrobial'], ['tazobactam', 'antimicrobial'],
  ['tigecycline', 'antimicrobial'], ['streptomycin', 'antimicrobial'], ['rifafour', 'antimicrobial'],
  ['primaquine', 'antimicrobial'], ['quinine', 'antimicrobial'], ['eurartesim', 'antimicrobial'],
  ['piperaquine', 'antimicrobial'], ['ertapenem', 'antimicrobial'], ['amphotericin', 'antimicrobial'],
  ['remdesivir', 'antimicrobial'], ['molnupiravir', 'antimicrobial'], ['favipiravir', 'antimicrobial'],
  ['efavirenz', 'antimicrobial'], ['lamivudine', 'antimicrobial'], ['lopinavir', 'antimicrobial'],
  ['tenofovir', 'antimicrobial'], ['zidovudine', 'antimicrobial'], ['gpo-vir', 'antimicrobial'],
  ['kaletra', 'antimicrobial'], ['dtg/3tc', 'antimicrobial'], ['gpo-l-one', 'antimicrobial'],
  // ยามะเร็ง/เคมีบำบัด/กดภูมิคุ้มกัน
  ['methotrexate', 'oncology'], ['tamoxifen', 'oncology'], ['flutamide', 'oncology'],
  ['deferasirox', 'oncology'], ['azathioprine', 'oncology'],
  // ยาโรคหัวใจ/หลอดเลือด/ความดัน
  ['enalapril', 'cardio'], ['captopril', 'cardio'], ['lisinopril', 'cardio'], ['perindopril', 'cardio'],
  ['ramipril', 'cardio'], ['losartan', 'cardio'], ['valsartan', 'cardio'], ['telmisartan', 'cardio'],
  ['amlodipine', 'cardio'], ['nifedipine', 'cardio'], ['felodipine', 'cardio'], ['diltiazem', 'cardio'],
  ['verapamil', 'cardio'], ['atenolol', 'cardio'], ['propranolol', 'cardio'], ['metoprolol', 'cardio'],
  ['bisoprolol', 'cardio'], ['carvedilol', 'cardio'], ['methyldopa', 'cardio'], ['hydralazine', 'cardio'],
  ['prazosin', 'cardio'], ['doxazosin', 'cardio'], ['hydrochlorothiazide', 'cardio'], ['hctz', 'cardio'],
  ['furosemide', 'cardio'], ['spironolactone', 'cardio'], ['indapamide', 'cardio'], ['digoxin', 'cardio'],
  ['isosorbide', 'cardio'], ['nitroglycerin', 'cardio'], ['glyceryl trinitrate', 'cardio'],
  ['warfarin', 'cardio'], ['clopidogrel', 'cardio'], ['enoxaparin', 'cardio'], ['heparin', 'cardio'],
  ['nicardipine', 'cardio'], ['ticagrelor', 'cardio'], ['edoxaban', 'cardio'], ['dipyridamole', 'cardio'],
  ['cilostazol', 'cardio'], ['lercanidipine', 'cardio'], ['manidipine', 'cardio'], ['irbesartan', 'cardio'],
  ['fimasartan', 'cardio'], ['vastarel', 'cardio'], ['trimetazidine', 'cardio'], ['clonidine', 'cardio'],
  ['bemiparin', 'cardio'], ['plavix', 'cardio'], ['daflon', 'cardio'], ['tranexamic', 'cardio'],
  ['transamin', 'cardio'], ['doxazocin', 'cardio'], ['sildenafil', 'cardio'], ['ความดัน', 'cardio'],
  // ยาเบาหวาน/ต่อมไร้ท่อ/ไขมัน
  ['metformin', 'endocrine'], ['glipizide', 'endocrine'], ['gliclazide', 'endocrine'],
  ['glibenclamide', 'endocrine'], ['glimepiride', 'endocrine'], ['pioglitazone', 'endocrine'],
  ['sitagliptin', 'endocrine'], ['vildagliptin', 'endocrine'], ['acarbose', 'endocrine'],
  ['insulin', 'endocrine'], ['gensulin', 'endocrine'], ['mixtard', 'endocrine'], ['novomix', 'endocrine'],
  ['simvastatin', 'endocrine'], ['atorvastatin', 'endocrine'],
  ['rosuvastatin', 'endocrine'], ['gemfibrozil', 'endocrine'], ['fenofibrate', 'endocrine'],
  ['levothyroxine', 'endocrine'], ['propylthiouracil', 'endocrine'], ['carbimazole', 'endocrine'],
  ['empagliflozin', 'endocrine'], ['pravastatin', 'endocrine'], ['pitavastatin', 'endocrine'],
  ['ezetimibe', 'endocrine'], ['cinacalcet', 'endocrine'], ['methimazole', 'endocrine'],
  ['dutasteride', 'endocrine'], ['finasteride', 'endocrine'], ['tamsulosin', 'endocrine'],
  ['alfuzosin', 'endocrine'], ['l-thyrosine', 'endocrine'], ['เบาหวาน', 'endocrine'],
  // ฮอร์โมน/คุมกำเนิด/สูติศาสตร์
  ['medroxyprogesterone', 'hormone_repro'], ['dmpa', 'hormone_repro'], ['implanon', 'hormone_repro'],
  ['etonorgestrel', 'hormone_repro'], ['etonogestrel', 'hormone_repro'], ['lynestrenol', 'hormone_repro'],
  ['exluton', 'hormone_repro'], ['norethisteron', 'hormone_repro'], ['primolut', 'hormone_repro'],
  ['provera', 'hormone_repro'], ['utrogestan', 'hormone_repro'], ['hydroxyprogesterone', 'hormone_repro'],
  ['proluton', 'hormone_repro'], ['ethinylestradiol', 'hormone_repro'], ['levonorgestrel', 'hormone_repro'],
  ['oxytocin', 'hormone_repro'], ['syntocinon', 'hormone_repro'], ['methylergometrine', 'hormone_repro'],
  ['methergin', 'hormone_repro'], ['sulprostone', 'hormone_repro'], ['nalador', 'hormone_repro'],
  ['cytotec', 'hormone_repro'], ['คุมกำเนิด', 'hormone_repro'],
  // ยาระบบทางเดินหายใจ/หอบหืด
  ['salbutamol', 'resp'], ['ventolin', 'resp'], ['terbutaline', 'resp'], ['budesonide', 'resp'],
  ['fluticasone', 'resp'], ['beclomethasone', 'resp'], ['ipratropium', 'resp'], ['salmeterol', 'resp'],
  ['montelukast', 'resp'], ['theophylline', 'resp'], ['aminophylline', 'resp'],
  ['dextromethorphan', 'resp'], ['bromhexine', 'resp'], ['ambroxol', 'resp'], ['carbocisteine', 'resp'],
  ['carbocysteine', 'resp'], ['guaifenesin', 'resp'], ['guafenesin', 'resp'], ['codeine', 'resp'],
  ['seretide', 'resp'], ['spiolto', 'resp'], ['spiriva', 'resp'], ['anoro', 'resp'], ['tiotropium', 'resp'],
  ['berodual', 'resp'], ['procaterol', 'resp'], ['meptin', 'resp'], ['tussis', 'resp'],
  ['acetylcysteine', 'resp'],
  ['หอบหืด', 'resp'], ['ยาพ่น', 'resp'],
  // ยาระบบทางเดินอาหาร
  ['omeprazole', 'gi'], ['esomeprazole', 'gi'], ['lansoprazole', 'gi'], ['pantoprazole', 'gi'],
  ['rabeprazole', 'gi'], ['ranitidine', 'gi'], ['famotidine', 'gi'], ['antacid', 'gi'],
  ['aluminium hydroxide', 'gi'], ['magnesium hydroxide', 'gi'], ['sucralfate', 'gi'],
  ['domperidone', 'gi'], ['metoclopramide', 'gi'], ['ondansetron', 'gi'], ['hyoscine', 'gi'],
  ['dicyclomine', 'gi'], ['loperamide', 'gi'], ['oral rehydration', 'gi'], ['ors', 'gi'],
  ['senna', 'gi'], ['bisacodyl', 'gi'], ['lactulose', 'gi'], ['simeticone', 'gi'], ['simethicone', 'gi'],
  ['charcoal', 'gi'], ['multi-enzyme', 'gi'], ['digestive enzyme', 'gi'],
  ['mosapride', 'gi'], ['rebamipide', 'gi'], ['vonoprazan', 'gi'], ['gastrobismol', 'gi'],
  ['bismuth subsalicylate', 'gi'], ['milk of magnesia', 'gi'], ['kalimate', 'gi'], ['swiff', 'gi'],
  ['alum milk', 'gi'], ['carminative', 'gi'], ['mucillin', 'gi'], ['pan-enteral', 'gi'],
  ['drotaverine', 'gi'], ['ใบมะขามแขก', 'gi'], ['glycerine rectal', 'gi'], ['unison enema', 'gi'],
  ['algycon', 'gi'], ['peppermint oil', 'gi'], ['ท้องเสีย', 'gi'],
  // ยาระบบประสาท/จิตเวช/นอนไม่หลับ
  // Bug fix: 'diazepam inj' further down (ยาฉุกเฉิน/ช่วยชีวิต) was unreachable — RULES is
  // matched top-to-bottom with first-match-wins (see this file's own header comment: "more
  // specific keywords are listed before broad ones"), but the broad 'diazepam' rule below used
  // to sit BEFORE it, so any injectable diazepam name (a real status-epilepticus/emergency
  // stock item) always matched here first and got mis-bucketed as neuro_psych, never falling
  // through to the more specific emergency rule. Listed here, ahead of the generic 'diazepam'.
  ['diazepam inj', 'emergency'],
  ['diazepam', 'neuro_psych'], ['lorazepam', 'neuro_psych'], ['alprazolam', 'neuro_psych'],
  ['midazolam', 'neuro_psych'], ['amitriptyline', 'neuro_psych'], ['nortriptyline', 'neuro_psych'],
  ['fluoxetine', 'neuro_psych'], ['sertraline', 'neuro_psych'], ['escitalopram', 'neuro_psych'],
  ['phenytoin', 'neuro_psych'], ['carbamazepine', 'neuro_psych'], ['sodium valproate', 'neuro_psych'],
  ['valproic', 'neuro_psych'], ['gabapentin', 'neuro_psych'], ['pregabalin', 'neuro_psych'],
  ['levodopa', 'neuro_psych'], ['risperidone', 'neuro_psych'], ['haloperidol', 'neuro_psych'],
  ['olanzapine', 'neuro_psych'], ['quetiapine', 'neuro_psych'], ['chlorpromazine', 'neuro_psych'],
  ['nortriptyline', 'neuro_psych'], ['flunarizine', 'neuro_psych'], ['betahistine', 'neuro_psych'],
  ['cinnarizine', 'neuro_psych'], ['dimenhydrinate', 'neuro_psych'], ['clonazepam', 'neuro_psych'],
  ['lithium', 'neuro_psych'], ['depakine', 'neuro_psych'], ['topiramate', 'neuro_psych'],
  ['venlafaxine', 'neuro_psych'], ['deanxit', 'neuro_psych'], ['clozapine', 'neuro_psych'],
  ['perphenazine', 'neuro_psych'], ['fluphenazine', 'neuro_psych'], ['thioridazine', 'neuro_psych'],
  ['imipramine', 'neuro_psych'], ['methylphenidate', 'neuro_psych'], ['benzhexol', 'neuro_psych'],
  ['benztropine', 'neuro_psych'], ['ropinirole', 'neuro_psych'], ['clorazepate', 'neuro_psych'],
  ['cafergot', 'neuro_psych'], ['levetiracetam', 'neuro_psych'], ['keppra', 'neuro_psych'],
  ['phenobarbital', 'neuro_psych'], ['trazodone', 'neuro_psych'],
  // ยาชา/ยาคลายกล้ามเนื้อ
  ['lidocaine', 'anesthetic'], ['lignocaine', 'anesthetic'], ['bupivacaine', 'anesthetic'],
  ['orphenadrine', 'anesthetic'], ['tolperisone', 'anesthetic'], ['baclofen', 'anesthetic'],
  ['ethyl chloride', 'anesthetic'], ['xylocaine', 'anesthetic'], ['ยาชา', 'anesthetic'],
  // ยาแก้แพ้/ภูมิแพ้
  ['chlorpheniramine', 'allergy'], ['cetirizine', 'allergy'], ['loratadine', 'allergy'],
  ['fexofenadine', 'allergy'], ['desloratadine', 'allergy'], ['diphenhydramine', 'allergy'],
  ['hydroxyzine', 'allergy'], ['cpm', 'allergy'], ['แก้แพ้', 'allergy'],
  // ยาผิวหนัง/ยาทาภายนอก
  ['hydrocortisone cream', 'derm'], ['hydrocortisone ointment', 'derm'], ['betamethasone cream', 'derm'],
  ['betamethasone ointment', 'derm'], ['clotrimazole cream', 'derm'], ['miconazole cream', 'derm'],
  ['silver sulfadiazine', 'derm'], ['calamine', 'derm'], ['whitfield', 'derm'], ['salicylic', 'derm'],
  ['permethrin', 'derm'], ['benzyl benzoate', 'derm'], ['gentian violet', 'derm'],
  ['fusidic acid', 'derm'], ['mupirocin', 'derm'], ['neomycin cream', 'derm'],
  ['zinc  paste', 'derm'], ['zinc paste', 'derm'], ['urea 10', 'derm'], ['sofra-tulle', 'derm'],
  ['betamethasone 0.1', 'derm'],
  ['proctosedyl', 'derm'], ['diprosone', 'derm'], ['analgesic balm', 'derm'], ['ยาทา', 'derm'],
  // ยาตา/หู/คอ/จมูก
  ['eye drop', 'eye_ent'], ['eye ointment', 'eye_ent'], ['ear drop', 'eye_ent'],
  ['tetrahydrozoline', 'eye_ent'], ['chloramphenicol eye', 'eye_ent'], ['tobramycin eye', 'eye_ent'],
  ['gentamicin eye', 'eye_ent'], ['normal saline nasal', 'eye_ent'], ['xylometazoline', 'eye_ent'],
  ['oxymetazoline', 'eye_ent'], ['hista-oph', 'eye_ent'], ['lac-oph', 'eye_ent'], ['poly-oph', 'eye_ent'],
  ['mometasone', 'eye_ent'], ['brimonidine', 'eye_ent'], ['bimatoprost', 'eye_ent'], ['azarga', 'eye_ent'],
  ['brinzolamide', 'eye_ent'], ['olive oil', 'eye_ent'], ['glycerine borax', 'eye_ent'],
  ['chlorhexidine mouth', 'eye_ent'], ['ยาหยอดตา', 'eye_ent'], ['ยาหยอดหู', 'eye_ent'],
  // วิตามิน/เกลือแร่/อาหารเสริม
  ['vitamin', 'vitamin'], ['วิตามิน', 'vitamin'], ['folic acid', 'vitamin'], ['ferrous', 'vitamin'],
  ['calcium carbonate', 'vitamin'], ['calcium lactate', 'vitamin'], ['multivitamin', 'vitamin'],
  ['tri-vi', 'vitamin'], ['potassium chloride', 'vitamin'], ['zinc sulfate', 'vitamin'],
  ['zinc sulphate', 'vitamin'], ['b complex', 'vitamin'], ['b1-6-12', 'vitamin'],
  ['b-100 complex', 'vitamin'], ['alfacalcidol', 'vitamin'], ['calcitriol', 'vitamin'],
  ['kcl', 'vitamin'], ['dipotassium phosphate', 'vitamin'], ['nacl tab', 'vitamin'],
  ['sodium  bicarbonate', 'vitamin'],
  ['triferdine', 'vitamin'],
  // สารน้ำ/IV fluid
  ['normal saline', 'iv_fluid'], ['0.9% nacl', 'iv_fluid'], ['dextrose', 'iv_fluid'],
  ['ringer', 'iv_fluid'], ['nss', 'iv_fluid'], ['d5w', 'iv_fluid'], ['d5ns', 'iv_fluid'],
  ['acetar', 'iv_fluid'], ['lactated ringer', 'iv_fluid'], ['mannitol', 'iv_fluid'],
  ['d-5-n', 'iv_fluid'], ['d-5-w', 'iv_fluid'], ['dextran', 'iv_fluid'], ['sterile water', 'iv_fluid'],
  ['nacl 3', 'iv_fluid'], ['สารน้ำ', 'iv_fluid'], ['น้ำเกลือ', 'iv_fluid'],
  // ยาฉุกเฉิน/ช่วยชีวิต
  ['adrenaline', 'emergency'], ['epinephrine', 'emergency'], ['atropine', 'emergency'],
  ['naloxone', 'emergency'], ['sodium bicarbonate', 'emergency'], ['calcium gluconate', 'emergency'],
  ['amiodarone', 'emergency'], ['dopamine', 'emergency'], ['norepinephrine', 'emergency'],
  ['succinylcholine', 'emergency'], ['adenosine', 'emergency'], ['streptokinase', 'emergency'],
  ['tenecteplase', 'emergency'], ['magnesium sulfate', 'emergency'], ['magnesium sulphate', 'emergency'],
  ['aromatic ammonia', 'emergency'],
  // วัคซีน/เซรุ่ม/อิมมูโนโกลบูลิน
  ['tuberculin', 'vaccine_biologic'],
  ['vaccine', 'vaccine_biologic'], ['วัคซีน', 'vaccine_biologic'], ['immunoglobulin', 'vaccine_biologic'],
  ['immune globulin', 'vaccine_biologic'], ['antitoxin', 'vaccine_biologic'], ['anti toxin', 'vaccine_biologic'], ['antivenin', 'vaccine_biologic'],
  ['antivenom', 'vaccine_biologic'], ['antivenum', 'vaccine_biologic'], ['งูกะปะ', 'vaccine_biologic'],
  ['งูเห่า', 'vaccine_biologic'], ['bcg', 'vaccine_biologic'], ['dtp', 'vaccine_biologic'],
  ['mmr', 'vaccine_biologic'], ['opv', 'vaccine_biologic'], ['ipv', 'vaccine_biologic'],
  ['menactra', 'vaccine_biologic'], ['verorab', 'vaccine_biologic'], ['sinovac', 'vaccine_biologic'],
  ['sinopharm', 'vaccine_biologic'], ['astrazeneca', 'vaccine_biologic'], ['pfizer', 'vaccine_biologic'],
  ['hpv', 'vaccine_biologic'], ['cecolin', 'vaccine_biologic'], ['je vaccine', 'vaccine_biologic'],
  ['dt vaccine', 'vaccine_biologic'], ['human albumin', 'vaccine_biologic'], ['erythropoietin', 'vaccine_biologic'],
  ['filgrastim', 'vaccine_biologic'],
  // ยาสมุนไพร/แผนไทย
  ['ขมิ้นชัน', 'herbal'], ['ฟ้าทะลายโจร', 'herbal'], ['เถาวัลย์เปรียง', 'herbal'], ['ขิงแคปซูล', 'herbal'],
  ['ยาหอม', 'herbal'], ['สหัสธารา', 'herbal'], ['ธาตุบรรจบ', 'herbal'], ['ห้าราก', 'herbal'],
  ['ตรีผลา', 'herbal'], ['ศุขไสยาศน์', 'herbal'], ['จันทน์ลีลา', 'herbal'], ['จันทลีลา', 'herbal'],
  ['เพชรสังฆาต', 'herbal'], ['ประสะ', 'herbal'], ['เบญจกูล', 'herbal'],
  ['ชุมเห็ดเทศ', 'herbal'], ['รางจืด', 'herbal'], ['ยาธาตุ', 'herbal'], ['มะขามป้อม', 'herbal'],
  ['พญายอ', 'herbal'], ['ยาเขียวหอม', 'herbal'], ['น้ำมันไพล', 'herbal'], ['มะแว้ง', 'herbal'],
  ['ตราธนัทเฮิร์บ', 'herbal'], ['ตราธงทอง', 'herbal'], ['ลูกประคบ', 'herbal'], ['มันทธาตุ', 'herbal'],
  ['ทำลายพระสุเมรุ', 'herbal'], ['ธรณีสันธะฆาต', 'herbal'], ['แก้ลมแก้เส้น', 'herbal'],
  ['น้ำมันกัญชา', 'herbal'], ['มหาหิงค์', 'herbal'], ['น้ำยาลดบุหรี่', 'herbal'], ['สมุนไพร', 'herbal'],
  // เวชภัณฑ์ที่ไม่ใช่ยา
  ['gauze', 'supply'], ['ผ้าก๊อซ', 'supply'], ['bandage', 'supply'], ['ผ้าพันแผล', 'supply'],
  ['syringe', 'supply'], ['กระบอกฉีดยา', 'supply'], ['needle', 'supply'], ['เข็มฉีดยา', 'supply'],
  ['cotton', 'supply'], ['สำลี', 'supply'], ['iv set', 'supply'], ['iv cannula', 'supply'],
  ['catheter', 'supply'], ['glove', 'supply'], ['ถุงมือ', 'supply'], ['plaster', 'supply'],
  ['micropore', 'supply'], ['elastic bandage', 'supply'], ['alcohol', 'supply'], ['betadine', 'supply'],
  ['povidone', 'supply'], ['hydrogen peroxide', 'supply'], ['3% h2o2', 'supply'], ['mask', 'supply'],
  ['hibiscrub', 'supply'],
];

/** Returns a suggested category id from a drug's name/strength text, or null when nothing in
 * the keyword list matches — callers always treat null as "no suggestion to offer", never as
 * UNCATEGORIZED being the suggestion itself. */
export function suggestCategoryId(name: string): string | null {
  const n = name.toLowerCase();
  for (const [kw, id] of RULES) {
    if (n.indexOf(kw) >= 0) return id === UNCATEGORIZED ? null : id;
  }
  return null;
}
