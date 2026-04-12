import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";


const diseasesData = [
  {
    id: 1,
    name: "Dengue Fever",
    type: "Viral",
    description:
      "Dengue is a viral infection spread by mosquitoes. It causes high fever, severe body pain, and can be life-threatening if not treated properly.",
    causes: [
      "Bite from infected Aedes mosquito (usually bites during daytime)",
      "Cannot spread person to person",
      "Common during rainy season",
    ],
    symptoms: [
      "Very high fever (103-105°F)",
      "Severe headache behind eyes",
      "Joint and muscle pain (break-bone fever)",
      "Skin rash after 2-3 days",
      "Mild bleeding (nose, gums)",
      "Extreme tiredness",
      "Nausea and vomiting",
    ],
    remedies: [
      "Drink lots of water, juice, and coconut water",
      "Take paracetamol for fever (NO aspirin or ibuprofen)",
      "Complete bed rest",
      "Eat papaya leaf juice (increases platelets)",
      "Drink pomegranate juice",
      "Eat soft, nutritious food (khichdi, soup)",
      "Monitor for warning signs",
    ],
    warning:
      "Visit doctor immediately if fever doesn't decrease after 2-3 days or bleeding starts",
    color: "#F44336", 
  },
  {
    id: 2,
    name: "Diarrhea",
    type: "Infection",
    description:
      "Diarrhea is when you pass loose, watery stools 3 or more times a day. It can make you dehydrated quickly.",
    causes: [
      "Contaminated food or water",
      "Viral or bacterial infection",
      "Food poisoning",
      "Eating too much oily food",
      "Lactose intolerance",
      "Stress or anxiety",
    ],
    symptoms: [
      "Frequent watery stools",
      "Stomach cramps and pain",
      "Urgent need to use toilet",
      "Nausea",
      "Bloating",
      "Fever (if infection)",
      "Weakness",
    ],
    remedies: [
      "Drink ORS (oral rehydration solution) every 2 hours",
      "Eat banana (potassium replacement)",
      "Drink plain yogurt",
      "Have boiled rice with yogurt",
      "Drink ginger tea",
      "Eat toast or plain biscuits",
      "Avoid milk, oily food, spicy food",
      "Stay hydrated with clean water",
    ],
    warning:
      "See doctor if blood in stool, severe dehydration, or lasts more than 2 days",
    color: "#FF9800", 
  },
  {
    id: 3,
    name: "Hepatitis A",
    type: "Viral",
    description:
      "Hepatitis A is a liver infection caused by a virus. It spreads through contaminated food and water.",
    causes: [
      "Eating food prepared by infected person",
      "Drinking contaminated water",
      "Poor hygiene and sanitation",
      "Eating raw shellfish from polluted water",
      "Close contact with infected person",
    ],
    symptoms: [
      "Fever and fatigue",
      "Loss of appetite",
      "Nausea and vomiting",
      "Dark yellow urine",
      "Yellow eyes and skin (jaundice)",
      "Pale or clay-colored stool",
      "Stomach pain (right side)",
      "Joint pain",
    ],
    remedies: [
      "Complete bed rest for 2-3 weeks",
      "Drink plenty of fluids (water, fresh juice)",
      "Eat light, easily digestible food",
      "Have turmeric milk daily",
      "Drink sugarcane juice",
      "Avoid alcohol completely",
      "Eat small frequent meals",
      "Take vitamin C rich fruits (orange, amla)",
    ],
    warning: "Requires medical supervision. Get vaccinated to prevent",
    color: "#FFC107", 
  },
  {
    id: 4,
    name: "Influenza (Flu)",
    type: "Viral",
    description:
      "Flu is a contagious respiratory illness caused by influenza virus. It affects nose, throat, and lungs.",
    causes: [
      "Breathing in droplets from infected person's cough/sneeze",
      "Touching contaminated surfaces then touching face",
      "Close contact with flu patient",
      "Spreads easily in crowded places",
    ],
    symptoms: [
      "Sudden high fever (101-104°F)",
      "Severe body aches",
      "Dry cough",
      "Sore throat",
      "Runny or stuffy nose",
      "Headache",
      "Extreme tiredness",
      "Sometimes vomiting and diarrhea",
    ],
    remedies: [
      "Rest in bed for 3-5 days",
      "Drink warm water, herbal tea, soup",
      "Gargle with salt water 3 times daily",
      "Take steam inhalation",
      "Eat honey with lukewarm water",
      "Drink ginger tea with honey",
      "Have chicken soup",
      "Take paracetamol for fever",
      "Use humidifier in room",
    ],
    warning:
      "See doctor if breathing difficulty, chest pain, or fever lasts more than 3 days",
    color: "#2196F3", 
  },
  {
    id: 5,
    name: "Tuberculosis (TB)",
    type: "Bacterial",
    description:
      "TB is a serious bacterial infection that mainly affects lungs. It spreads through air and needs long-term treatment.",
    causes: [
      "Breathing in bacteria from TB patient's cough",
      "Living with TB patient",
      "Weak immune system",
      "Malnutrition",
      "Smoking",
      "Diabetes increases risk",
    ],
    symptoms: [
      "Cough lasting more than 3 weeks",
      "Coughing up blood or mucus",
      "Chest pain when breathing",
      "Night sweats",
      "Fever (especially evening)",
      "Unexplained weight loss",
      "Extreme tiredness",
      "Loss of appetite",
    ],
    remedies: [
      "Take all prescribed medicines for 6-9 months (never stop early)",
      "Eat nutritious food (eggs, meat, milk, fruits)",
      "Get plenty of rest",
      "Take vitamin D (sunlight exposure)",
      "Drink milk with turmeric",
      "Eat garlic regularly",
      "Practice deep breathing exercises",
      "Maintain good hygiene",
    ],
    warning:
      "TB is curable but needs complete medical treatment. Don't rely on home remedies alone",
    color: "#9C27B0", 
  },
  {
    id: 6,
    name: "Malaria",
    type: "Parasitic",
    description:
      "Malaria is a serious disease caused by parasites transmitted through mosquito bites. Common in Pakistan during monsoon.",
    causes: [
      "Bite from infected female Anopheles mosquito",
      "Usually bites at night",
      "Parasite enters blood and multiplies",
    ],
    symptoms: [
      "High fever with chills",
      "Shaking and shivering",
      "Heavy sweating",
      "Severe headache",
      "Muscle pain",
      "Nausea and vomiting",
      "Tiredness",
      "Symptoms occur in cycles (every 48-72 hours)",
    ],
    remedies: [
      "Take prescribed antimalarial medicines completely",
      "Rest in cool, comfortable place",
      "Drink plenty of fluids",
      "Take paracetamol for fever",
      "Eat light, nutritious food",
      "Drink cinnamon tea",
      "Have fresh orange juice",
      "Eat dates for energy",
      "Use mosquito nets and repellents",
    ],
    warning: "Visit doctor immediately for blood test and treatment",
    color: "#795548", 
  },
  {
    id: 7,
    name: "Skin Allergy",
    type: "Allergy",
    description:
      "Skin allergy is when your skin reacts to something it's sensitive to, causing rash, itching, or redness.",
    causes: [
      "Contact with certain metals (nickel in jewelry)",
      "Cosmetics or soaps",
      "Certain fabrics (synthetic clothes)",
      "Plants or pollen",
      "Insect bites",
      "Food allergies",
      "Medicines",
      "Dust or mold",
    ],
    symptoms: [
      "Red, itchy skin",
      "Rash or hives",
      "Swelling",
      "Dry, cracked skin",
      "Burning sensation",
      "Blisters (in severe cases)",
      "Peeling skin",
    ],
    remedies: [
      "Apply cold compress (10-15 minutes)",
      "Use aloe vera gel on affected area",
      "Apply coconut oil",
      "Take oatmeal bath",
      "Apply calamine lotion",
      "Use neem paste on rash",
      "Apply cucumber slices",
      "Avoid scratching (trim nails)",
      "Wear loose cotton clothes",
      "Avoid trigger (soap, jewelry, etc.)",
      "Take antihistamine if needed",
    ],
    warning:
      "See doctor if swelling spreads, breathing difficulty, or severe reaction",
    color: "#E91E63", 
  },
  {
    id: 8,
    name: "Typhoid Fever",
    type: "Bacterial",
    description:
      "Typhoid is a bacterial infection that spreads through contaminated food and water. It causes prolonged fever and can be serious.",
    causes: [
      "Eating food contaminated with Salmonella bacteria",
      "Drinking contaminated water",
      "Poor hand hygiene",
      "Contact with carrier person",
      "Eating street food",
      "Poor sanitation",
    ],
    symptoms: [
      "Sustained high fever (103-104°F)",
      "Weakness and fatigue",
      "Stomach pain",
      "Headache",
      "Loss of appetite",
      "Constipation or diarrhea",
      "Rose-colored spots on chest",
      "Confusion (in severe cases)",
    ],
    remedies: [
      "Complete bed rest for 2-3 weeks",
      "Take all prescribed antibiotics",
      "Drink lots of fluids (ORS, water, juice)",
      "Eat light, easily digestible food",
      "Have banana for energy",
      "Drink buttermilk",
      "Eat yogurt for probiotics",
      "Have coconut water",
      "Avoid spicy, oily food",
      "Maintain strict hygiene",
    ],
    warning: "Requires medical treatment and blood test confirmation",
    color: "#607D8B", // Blue Grey
  },
  {
    id: 9,
    name: "Common Cold",
    type: "Viral",
    description:
      "Common cold is a viral infection of upper respiratory tract (nose and throat). It's harmless but uncomfortable.",
    causes: [
      "More than 200 different viruses",
      "Spread through cough and sneeze droplets",
      "Touching contaminated surfaces",
      "Close contact with cold patient",
      "Weather changes",
      "Weak immunity",
    ],
    symptoms: [
      "Runny or stuffy nose",
      "Sneezing",
      "Sore throat",
      "Mild cough",
      "Mild headache",
      "Low-grade fever (sometimes)",
      "Watery eyes",
      "Mild body aches",
      "Lasts 7-10 days",
    ],
    remedies: [
      "Rest and sleep well",
      "Drink warm liquids (tea, soup, warm water)",
      "Gargle with salt water (3-4 times daily)",
      "Take steam inhalation",
      "Drink honey with lukewarm water",
      "Have ginger tea",
      "Eat garlic or add to food",
      "Use eucalyptus oil for steam",
      "Keep throat warm (wear scarf)",
      "Drink vitamin C juice (orange, lemon)",
      "Use tissue and dispose properly",
      "Wash hands frequently",
    ],
    warning:
      "No cure for cold, it goes away on its own. See doctor if symptoms worsen",
    color: "#009688", // Teal
  },
  {
    id: 10,
    name: "Urinary Tract Infection",
    type: "Infection",
    description:
      "UTI is an infection in any part of urinary system (kidneys, bladder, urethra). More common in women.",
    causes: [
      "Bacteria (usually E. coli) entering urinary tract",
      "Poor hygiene",
      "Holding urine for too long",
      "Not drinking enough water",
      "Sexual activity",
      "Diabetes",
      "Pregnancy",
      "Menopause",
    ],
    symptoms: [
      "Burning sensation when urinating",
      "Frequent urge to urinate (but little comes out)",
      "Cloudy or dark urine",
      "Strong-smelling urine",
      "Blood in urine (sometimes)",
      "Pelvic pain (in women)",
      "Lower back pain",
      "Fever (if kidney infection)",
    ],
    remedies: [
      "Drink lots of water (8-10 glasses daily)",
      "Drink cranberry juice",
      "Take vitamin C (increases urine acidity)",
      "Don't hold urine, go immediately",
      "Urinate after sexual activity",
      "Wear cotton underwear",
      "Avoid tight clothes",
      "Wipe front to back (for women)",
      "Take probiotics (yogurt)",
      "Apply heating pad on lower abdomen",
      "Avoid caffeine and alcohol",
    ],
    warning:
      "See doctor if blood in urine, back pain, fever, or symptoms last more than 2 days. May need antibiotics",
    color: "#9E9E9E", 
  },
];



const FilterChip = ({ label, isActive, onPress }) => (
  <TouchableOpacity
    style={[
      styles.filterChip,
      isActive && { backgroundColor: "#0D47A1", borderColor: "#0D47A1" },
    ]}
    onPress={onPress}
  >
    <Text style={[styles.filterText, isActive && { color: "#FFF" }]}>
      {label}
    </Text>
  </TouchableOpacity>
);

const DiseaseCard = ({ item, expanded, toggleExpand }) => (
  <View style={styles.card}>
    <TouchableOpacity
      style={styles.cardHeader}
      onPress={toggleExpand}
      activeOpacity={0.8}
    >
      <View style={styles.headerLeft}>
        <View style={[styles.iconBox, { backgroundColor: `${item.color}20` }]}>
          <MaterialCommunityIcons
            name="medical-bag"
            size={24}
            color={item.color}
          />
        </View>
        <View>
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={[styles.cardType, { color: item.color }]}>
            {item.type}
          </Text>
        </View>
      </View>
      <MaterialCommunityIcons
        name={expanded ? "chevron-up" : "chevron-down"}
        size={24}
        color="#757575"
      />
    </TouchableOpacity>

    {expanded && (
      <View style={styles.cardBody}>
        <Text style={styles.description}>{item.description}</Text>

        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: item.color }]}>
            Causes
          </Text>
          {item.causes.map((cause, index) => (
            <View key={index} style={styles.listItem}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={16}
                color="#757575"
              />
              <Text style={styles.listText}>{cause}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: item.color }]}>
            Symptoms
          </Text>
          {item.symptoms.map((symptom, index) => (
            <View key={index} style={styles.listItem}>
              <MaterialCommunityIcons
                name="thermometer"
                size={16}
                color="#757575"
              />
              <Text style={styles.listText}>{symptom}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: item.color }]}>
            Home Remedies
          </Text>
          {item.remedies.map((remedy, index) => (
            <View key={index} style={styles.listItem}>
              <MaterialCommunityIcons
                name="check-circle-outline"
                size={16}
                color="#4CAF50"
              />
              <Text style={styles.listText}>{remedy}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.warningBox, { borderColor: item.color }]}>
          <MaterialCommunityIcons
            name="alert"
            size={20}
            color={item.color}
            style={{ marginRight: 8 }}
          />
          <Text style={[styles.warningText, { color: item.color }]}>
            {item.warning}
          </Text>
        </View>
      </View>
    )}
  </View>
);



export default function LibraryScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [expandedId, setExpandedId] = useState(null);

  const filters = [
    "All",
    "Viral",
    "Bacterial",
    "Infection",
    "Allergy",
    "Parasitic",
  ];

  const filteredDiseases = diseasesData.filter((item) => {
    const matchesSearch = item.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === "All" || item.type === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <LinearGradient colors={["#0D47A1", "#1976D2"]} style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Health Library</Text>
            <Text style={styles.headerSubtitle}>
              Common diseases & home remedies
            </Text>
          </View>
          <MaterialCommunityIcons
            name="book-open-page-variant"
            size={28}
            color="#FFF"
          />
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <MaterialCommunityIcons name="magnify" size={20} color="#757575" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search diseases (e.g., Dengue, Flu)..."
            placeholderTextColor="#9E9E9E"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <MaterialCommunityIcons
                name="close-circle"
                size={20}
                color="#757575"
              />
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      {/* Filters */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {filters.map((filter) => (
            <FilterChip
              key={filter}
              label={filter}
              isActive={activeFilter === filter}
              onPress={() => setActiveFilter(filter)}
            />
          ))}
        </ScrollView>
      </View>

      {/* List */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {filteredDiseases.length > 0 ? (
          filteredDiseases.map((item) => (
            <DiseaseCard
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              toggleExpand={() => toggleExpand(item.id)}
            />
          ))
        ) : (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="file-search-outline"
              size={60}
              color="#E0E0E0"
            />
            <Text style={styles.emptyText}>
              No diseases found matching "{searchQuery}"
            </Text>
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Emergency Numbers (Pakistan):</Text>
          <View style={styles.emergencyRow}>
            <View style={styles.emergencyBadge}>
              <MaterialCommunityIcons
                name="ambulance"
                size={16}
                color="#D32F2F"
              />
              <Text style={styles.emergencyNum}>1122</Text>
            </View>
            <View style={styles.emergencyBadge}>
              <MaterialCommunityIcons name="doctor" size={16} color="#D32F2F" />
              <Text style={styles.emergencyNum}>115</Text>
            </View>
            <View style={styles.emergencyBadge}>
              <MaterialCommunityIcons
                name="phone-plus"
                size={16}
                color="#D32F2F"
              />
              <Text style={styles.emergencyNum}>1166</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F7FA",
  },
  header: {
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight + 20 : 60,
    paddingBottom: 25,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#FFF",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.9)",
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 10,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    color: "#333",
  },
  filterContainer: {
    marginTop: 20,
    marginBottom: 10,
    paddingLeft: 20,
    height: 40,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginRight: 10,
    height: 36,
    justifyContent: "center",
  },
  filterText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#757575",
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    marginBottom: 15,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  cardType: {
    fontSize: 13,
    fontWeight: "600",
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: "#F5F5F5",
  },
  description: {
    fontSize: 14,
    color: "#616161",
    lineHeight: 22,
    marginTop: 15,
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  listText: {
    fontSize: 14,
    color: "#424242",
    marginLeft: 10,
    flex: 1,
    lineHeight: 20,
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 5,
  },
  warningText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  emptyState: {
    alignItems: "center",
    marginTop: 60,
  },
  emptyText: {
    marginTop: 10,
    fontSize: 16,
    color: "#9E9E9E",
  },
  footer: {
    marginTop: 20,
    alignItems: "center",
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: "#EEEEEE",
  },
  footerText: {
    fontSize: 14,
    color: "#757575",
    fontWeight: "600",
    marginBottom: 15,
  },
  emergencyRow: {
    flexDirection: "row",
    gap: 15,
  },
  emergencyBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFEBEE",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  emergencyNum: {
    color: "#D32F2F",
    fontWeight: "bold",
    fontSize: 14,
  },
});
